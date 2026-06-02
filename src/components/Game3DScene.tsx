import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useEffect, useState } from "react";
import * as THREE from "three";

// Build a Three.js sprite texture displaying an emoji.
function makeEmojiTexture(emoji: string, size = 128): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const cx = c.getContext("2d")!;
  cx.clearRect(0, 0, size, size);
  cx.font = `${Math.floor(size * 0.78)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  cx.textAlign = "center";
  cx.textBaseline = "middle";
  cx.fillText(emoji, size / 2, size / 2 + size * 0.04);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

// ===== Shared shapes (mirrors src/routes/index.tsx) =====
export interface Skin {
  id: string;
  name: string;
  price: number;
  fuse: [string, string, string];
  wing: [string, string, string];
  accent: string;
  emoji: string;
  vehicle?: string;
  category?: "skin" | "vehicle";
}
export interface MapTheme {
  id: string;
  name: string;
  price: number;
  sky: [string, string, string, string];
  sun: string;
  sunAlpha: string;
  emoji: string;
}
export interface Segment { topH: number; botH: number }
export interface Missile {
  x: number; y: number; vx: number; vy: number;
  trail: { x: number; y: number }[];
  emoji?: string; trailColor?: string; spin?: number;
}
export interface Coin { x: number; y: number; t: number }
export interface PowerUp { x: number; y: number; kind: "shield" | "slowmo" | "boost"; t: number; alive: boolean }

// 2D world dims (same as in index.tsx)
const W = 800;
const H = 500;
const PLANE_X = 140;
const SEG_W = 20;

// World-to-3D scaling
const XZ = 0.10;          // how much each 2D-x unit pushes into the scene
const YS = 0.045;         // vertical scale (2D-y -> 3D-y)
const WALL_DEPTH = SEG_W * XZ; // depth of each canyon slice

// Map a 2D x (already in world coords relative to scroll: x in [-something, W])
// to 3D z. Plane sits at z=0 — points ahead are negative z.
const xToZ = (x: number) => -(x - PLANE_X) * XZ;
const yToY = (y: number) => (H / 2 - y) * YS;

const POOL = {
  segments: 50,
  missiles: 12,
  coins: 60,
  powers: 6,
  portals: 4,
};

export interface GameRefs {
  planeY: React.MutableRefObject<number>;
  planeVy: React.MutableRefObject<number>;
  segments: React.MutableRefObject<Segment[]>;
  offset: React.MutableRefObject<number>;
  distance: React.MutableRefObject<number>;
  missiles: React.MutableRefObject<Missile[]>;
  coins: React.MutableRefObject<Coin[]>;
  powers: React.MutableRefObject<PowerUp[]>;
  portals: React.MutableRefObject<{ worldX: number; anchor: "top" | "bottom"; kind: string; entered: boolean }[]>;
  shield: React.MutableRefObject<boolean>;
  boost: React.MutableRefObject<number>;
  slowmo: React.MutableRefObject<number>;
  flash: React.MutableRefObject<number>;
  shake: React.MutableRefObject<number>;
  tick: React.MutableRefObject<number>;
  skin: React.MutableRefObject<Skin>;
  map: React.MutableRefObject<MapTheme>;
  alive: React.MutableRefObject<boolean>;
  rareEvent: React.MutableRefObject<{ kind: "star" | "asteroids" | "wreck" | "chase"; t: number; duration: number; seed: number } | null>;
}

interface Props {
  refs: GameRefs;
}

export default function Game3DScene({ refs }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <Canvas
      className="!absolute inset-0"
      camera={{ position: [0, 2.8, 5], fov: 60, near: 0.1, far: 200 }}
      dpr={[1, 1.6]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <Scene refs={refs} />
    </Canvas>
  );
}

function Scene({ refs }: { refs: GameRefs }) {
  const { scene, camera } = useThree();
  // World root receives a tiny shake offset
  const rootRef = useRef<THREE.Group>(null);
  // Sub-roots
  const segTopRef = useRef<THREE.InstancedMesh>(null);
  const segBotRef = useRef<THREE.InstancedMesh>(null);
  const missileRefs = useRef<(THREE.Group | null)[]>([]);
  const coinRefs = useRef<(THREE.Mesh | null)[]>([]);
  const powerRefs = useRef<(THREE.Mesh | null)[]>([]);
  const portalRefs = useRef<(THREE.Group | null)[]>([]);
  const planeRef = useRef<THREE.Group>(null);
  const shieldRef = useRef<THREE.Mesh>(null);

  const sunMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const sunLightRef = useRef<THREE.DirectionalLight>(null);

  // Apply current map background+fog
  useEffect(() => {
    const apply = () => {
      const m = refs.map.current;
      const top = new THREE.Color(m.sky[1]);
      const bot = new THREE.Color(m.sky[2]);
      scene.background = bot.clone().lerp(top, 0.5);
      scene.fog = new THREE.Fog(bot.getHex(), 8, 60);
    };
    apply();
    const id = setInterval(apply, 200);
    return () => clearInterval(id);
  }, [refs.map, scene]);

  // Pre-build star field
  const stars = useMemo(() => {
    const n = 220;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3 + 0] = (Math.random() - 0.5) * 80;
      pos[i * 3 + 1] = Math.random() * 24 - 4;
      pos[i * 3 + 2] = -Math.random() * 120;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);

  const tmpMat = useMemo(() => new THREE.Matrix4(), []);
  const tmpColor = useMemo(() => new THREE.Color(), []);

  useFrame((_, delta) => {
    const r = refs;
    const m = r.map.current;
    const isOther = m.id === "otherworld";
    const isCher = m.id === "chernobyl";

    // ===== Sky / fog refresh =====
    if (scene.fog) {
      const fogColor = new THREE.Color(isOther ? `hsl(${(r.tick.current * 0.8) % 360}, 70%, 18%)` : m.sky[1]);
      (scene.fog as THREE.Fog).color.copy(fogColor);
      if (scene.background instanceof THREE.Color) {
        const top = new THREE.Color(isOther ? `hsl(${(r.tick.current * 0.8 + 60) % 360}, 75%, 35%)` : m.sky[2]);
        scene.background.copy(top);
      }
    }

    if (sunMatRef.current) {
      sunMatRef.current.color.set(isCher ? "#222" : isOther ? `hsl(${(r.tick.current * 2) % 360}, 100%, 75%)` : m.sun);
    }
    if (sunLightRef.current) sunLightRef.current.color.set(m.sun);

    // ===== Plane =====
    if (planeRef.current) {
      const py = yToY(r.planeY.current);
      planeRef.current.position.set(0, py, 0);
      // bank/pitch from velocity
      const pitch = THREE.MathUtils.clamp(-r.planeVy.current * 0.12, -0.5, 0.5);
      planeRef.current.rotation.x = pitch;
      planeRef.current.rotation.z = pitch * 0.6;
      // hide if crashed
      planeRef.current.visible = r.alive.current;
    }
    if (shieldRef.current) {
      shieldRef.current.visible = r.shield.current && r.alive.current;
      shieldRef.current.rotation.y += delta * 1.5;
    }

    // ===== Camera (third person) =====
    const camTargetY = (planeRef.current?.position.y ?? 0) * 0.5 + 1.5;
    const shakeX = r.shake.current > 0 ? (Math.random() - 0.5) * r.shake.current * 0.04 : 0;
    const shakeY = r.shake.current > 0 ? (Math.random() - 0.5) * r.shake.current * 0.04 : 0;
    camera.position.x += (shakeX - camera.position.x) * 0.3;
    camera.position.y += (camTargetY + shakeY - camera.position.y) * 0.08;
    camera.position.z = r.boost.current > 0 ? 6 : 5;
    camera.lookAt(0, (planeRef.current?.position.y ?? 0) * 0.6, -8);

    // ===== Canyon walls (instanced) =====
    const segs = r.segments.current;
    const off = r.offset.current;
    if (segTopRef.current && segBotRef.current) {
      const topMesh = segTopRef.current;
      const botMesh = segBotRef.current;
      const count = Math.min(POOL.segments, segs.length);
      const wallColor = isCher ? new THREE.Color("#1a1a18") : isOther ? new THREE.Color(`hsl(${(r.tick.current * 1.5) % 360}, 80%, 25%)`) : new THREE.Color(m.sky[1]).lerp(new THREE.Color("#000"), 0.4);
      tmpColor.copy(wallColor);
      for (let i = 0; i < POOL.segments; i++) {
        if (i >= count) {
          tmpMat.makeScale(0.001, 0.001, 0.001);
          topMesh.setMatrixAt(i, tmpMat);
          botMesh.setMatrixAt(i, tmpMat);
          continue;
        }
        const seg = segs[i];
        // 2D x for left edge of this segment: i*SEG_W - off
        const x2d = i * SEG_W - off;
        const z = xToZ(x2d + SEG_W / 2);
        // top wall: from y=0 down to y=topH (2D). Convert to 3D.
        const topH3d = seg.topH * YS;
        const topCenterY = (H / 2) * YS - topH3d / 2;
        tmpMat.makeScale(3, Math.max(0.1, topH3d), WALL_DEPTH * 0.98);
        tmpMat.setPosition(0, topCenterY, z);
        topMesh.setMatrixAt(i, tmpMat);
        topMesh.setColorAt(i, tmpColor);
        const botH3d = seg.botH * YS;
        const botCenterY = -(H / 2) * YS + botH3d / 2;
        tmpMat.makeScale(3, Math.max(0.1, botH3d), WALL_DEPTH * 0.98);
        tmpMat.setPosition(0, botCenterY, z);
        botMesh.setMatrixAt(i, tmpMat);
        botMesh.setColorAt(i, tmpColor);
      }
      topMesh.instanceMatrix.needsUpdate = true;
      botMesh.instanceMatrix.needsUpdate = true;
      if (topMesh.instanceColor) topMesh.instanceColor.needsUpdate = true;
      if (botMesh.instanceColor) botMesh.instanceColor.needsUpdate = true;
    }

    // ===== Missiles =====
    const ms = r.missiles.current;
    for (let i = 0; i < POOL.missiles; i++) {
      const ref = missileRefs.current[i];
      if (!ref) continue;
      const m2 = ms[i];
      if (!m2) { ref.visible = false; continue; }
      ref.visible = true;
      ref.position.set(0, yToY(m2.y), xToZ(m2.x));
      const ang = Math.atan2(m2.vy, -m2.vx);
      ref.rotation.set(0, 0, ang);
      m2.spin = (m2.spin ?? 0) + delta * 4;
      ref.rotation.x = m2.spin;
    }

    // ===== Coins =====
    const cs = r.coins.current;
    for (let i = 0; i < POOL.coins; i++) {
      const ref = coinRefs.current[i];
      if (!ref) continue;
      const c = cs[i];
      if (!c) { ref.visible = false; continue; }
      ref.visible = true;
      ref.position.set(0, yToY(c.y), xToZ(c.x));
      ref.rotation.y = c.t * 0.15;
    }

    // ===== Powerups =====
    const ps = r.powers.current;
    for (let i = 0; i < POOL.powers; i++) {
      const ref = powerRefs.current[i];
      if (!ref) continue;
      const p = ps[i];
      if (!p) { ref.visible = false; continue; }
      ref.visible = true;
      ref.position.set(0, yToY(p.y), xToZ(p.x));
      ref.rotation.y = p.t * 0.08;
      const mat = ref.material as THREE.MeshStandardMaterial;
      mat.color.set(p.kind === "shield" ? "#6bd4ff" : p.kind === "slowmo" ? "#b48bff" : "#ffce4a");
      mat.emissive.copy(mat.color).multiplyScalar(0.5);
    }

    // ===== Portals =====
    const ports = r.portals.current;
    for (let i = 0; i < POOL.portals; i++) {
      const ref = portalRefs.current[i];
      if (!ref) continue;
      const p = ports[i];
      if (!p || p.entered) { ref.visible = false; continue; }
      const px = p.worldX - r.distance.current;
      if (px < -100 || px > W + 200) { ref.visible = false; continue; }
      ref.visible = true;
      const segIdx = Math.floor((px + r.offset.current) / SEG_W);
      const seg = segs[segIdx];
      const tunnelRadius = 36;
      const py2 = !seg ? H / 2 : p.anchor === "top" ? seg.topH + tunnelRadius : H - seg.botH - tunnelRadius;
      ref.position.set(0, yToY(py2), xToZ(px));
      ref.rotation.z += delta * 2;
    }
  });

  return (
    <group ref={rootRef}>
      <ambientLight intensity={0.55} />
      <directionalLight ref={sunLightRef} position={[10, 12, -8]} intensity={0.8} />
      <hemisphereLight args={["#ffffff", "#202030", 0.35]} />

      {/* Sun billboard far ahead */}
      <mesh position={[6, 5, -45]}>
        <sphereGeometry args={[2.2, 24, 24]} />
        <meshBasicMaterial ref={sunMatRef} color="#ffffff" />
      </mesh>

      {/* Stars */}
      <points geometry={stars}>
        <pointsMaterial size={0.18} color="#fff4d8" sizeAttenuation transparent opacity={0.85} />
      </points>

      {/* Canyon walls */}
      <instancedMesh ref={segTopRef} args={[undefined, undefined, POOL.segments]} castShadow={false} receiveShadow={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.9} metalness={0.1} />
      </instancedMesh>
      <instancedMesh ref={segBotRef} args={[undefined, undefined, POOL.segments]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.9} metalness={0.1} />
      </instancedMesh>

      {/* Plane / vehicle */}
      <group ref={planeRef}>
        <PlaneModel skinRef={refs.skin} />
        {/* shield bubble */}
        <mesh ref={shieldRef}>
          <sphereGeometry args={[0.9, 24, 16]} />
          <meshStandardMaterial color="#6bd4ff" transparent opacity={0.22} emissive="#6bd4ff" emissiveIntensity={0.4} />
        </mesh>
      </group>

      {/* Missile pool */}
      {Array.from({ length: POOL.missiles }).map((_, i) => (
        <group key={i} ref={(el) => { missileRefs.current[i] = el; }} visible={false}>
          <MissileModel index={i} missilesRef={refs.missiles} />
        </group>
      ))}

      {/* Coin pool */}
      {Array.from({ length: POOL.coins }).map((_, i) => (
        <mesh key={i} ref={(el) => { coinRefs.current[i] = el; }} visible={false} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.32, 0.32, 0.08, 18]} />
          <meshStandardMaterial color="#ffd84a" emissive="#ffaa00" emissiveIntensity={0.45} metalness={0.8} roughness={0.25} />
        </mesh>
      ))}

      {/* Powerup pool */}
      {Array.from({ length: POOL.powers }).map((_, i) => (
        <mesh key={i} ref={(el) => { powerRefs.current[i] = el; }} visible={false}>
          <octahedronGeometry args={[0.55, 0]} />
          <meshStandardMaterial color="#fff" emissive="#000" />
        </mesh>
      ))}

      {/* Portals */}
      {Array.from({ length: POOL.portals }).map((_, i) => (
        <group key={i} ref={(el) => { portalRefs.current[i] = el; }} visible={false}>
          <mesh>
            <torusGeometry args={[1.4, 0.18, 12, 32]} />
            <meshStandardMaterial color="#a060ff" emissive="#a060ff" emissiveIntensity={1.2} />
          </mesh>
          <mesh>
            <circleGeometry args={[1.3, 32]} />
            <meshBasicMaterial color="#60ffd0" transparent opacity={0.35} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}

      {/* Rare event visuals */}
      <RareEventLayer eventRef={refs.rareEvent} />
    </group>
  );
}

function PlaneModel({ skinRef }: { skinRef: React.MutableRefObject<Skin> }) {
  const groupRef = useRef<THREE.Group>(null);
  const fuseMat = useRef<THREE.MeshStandardMaterial>(null);
  const wingMat = useRef<THREE.MeshStandardMaterial>(null);
  const accentMat = useRef<THREE.MeshStandardMaterial>(null);
  const rotorRef = useRef<THREE.Mesh>(null);
  const [, force] = useState(0);
  const lastSkin = useRef<string>("");

  useFrame((_, dt) => {
    const s = skinRef.current;
    if (fuseMat.current) fuseMat.current.color.set(s.fuse[1]);
    if (wingMat.current) wingMat.current.color.set(s.wing[1]);
    if (accentMat.current) {
      accentMat.current.color.set(s.accent);
      accentMat.current.emissive.set(s.accent);
      accentMat.current.emissiveIntensity = 0.6;
    }
    if (rotorRef.current) rotorRef.current.rotation.y += dt * 30;
    if (lastSkin.current !== s.id) {
      lastSkin.current = s.id;
      force((n) => n + 1);
    }
  });

  const skin = skinRef.current;

  // Vehicles: render as big emoji sprite
  if (skin.vehicle) {
    return (
      <group ref={groupRef}>
        <EmojiSprite emoji={skin.emoji} size={1.8} />
        {skin.vehicle === "helicopter" && (
          <mesh ref={rotorRef} position={[0, 0.9, 0]}>
            <boxGeometry args={[2.6, 0.04, 0.12]} />
            <meshStandardMaterial color="#222" />
          </mesh>
        )}
      </group>
    );
  }

  // Default jet
  return (
    <group ref={groupRef} rotation={[0, Math.PI, 0]}>
      {/* Fuselage */}
      <mesh>
        <coneGeometry args={[0.32, 1.6, 16]} />
        <meshStandardMaterial ref={fuseMat} color={skin.fuse[1]} metalness={0.5} roughness={0.4} />
      </mesh>
      {/* Cockpit */}
      <mesh position={[0, 0.18, -0.15]}>
        <sphereGeometry args={[0.22, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#7ad4ff" metalness={0.6} roughness={0.1} transparent opacity={0.7} />
      </mesh>
      {/* Wings */}
      <mesh position={[0, -0.05, 0.05]}>
        <boxGeometry args={[2.2, 0.08, 0.55]} />
        <meshStandardMaterial ref={wingMat} color={skin.wing[1]} metalness={0.4} roughness={0.5} />
      </mesh>
      {/* Tail */}
      <mesh position={[0, 0.32, 0.65]}>
        <boxGeometry args={[0.08, 0.45, 0.4]} />
        <meshStandardMaterial color={skin.wing[1]} />
      </mesh>
      {/* Accent stripe */}
      <mesh position={[0, 0, 0.0]}>
        <torusGeometry args={[0.34, 0.04, 8, 24]} />
        <meshStandardMaterial ref={accentMat} color={skin.accent} emissive={skin.accent} emissiveIntensity={0.6} />
      </mesh>
      {/* Engine glow */}
      <mesh position={[0, 0, 0.85]}>
        <sphereGeometry args={[0.15, 12, 8]} />
        <meshBasicMaterial color="#ffd070" />
      </mesh>
    </group>
  );
}

function MissileModel({ index, missilesRef }: { index: number; missilesRef: React.MutableRefObject<Missile[]> }) {
  const [emoji, setEmoji] = useState<string | undefined>(undefined);
  useFrame(() => {
    const m = missilesRef.current[index];
    const e = m?.emoji;
    if (e !== emoji) setEmoji(e);
  });
  if (emoji) {
    return <EmojiSprite emoji={emoji} size={0.9} />;
  }
  return (
    <group rotation={[0, Math.PI / 2, 0]}>
      <mesh>
        <coneGeometry args={[0.14, 0.7, 12]} />
        <meshStandardMaterial color="#c8c8d0" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.35]}>
        <sphereGeometry args={[0.16, 12, 8]} />
        <meshBasicMaterial color="#ff8040" />
      </mesh>
    </group>
  );
}

function EmojiSprite({ emoji, size }: { emoji: string; size: number }) {
  const texture = useMemo(() => makeEmojiTexture(emoji, 128), [emoji]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <sprite scale={[size, size, size]}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  );
}

// ===================== RARE EVENTS =====================
type RareRef = React.MutableRefObject<{ kind: "star" | "asteroids" | "wreck" | "chase"; t: number; duration: number; seed: number } | null>;

function RareEventLayer({ eventRef }: { eventRef: RareRef }) {
  const [kind, setKind] = useState<null | "star" | "asteroids" | "wreck" | "chase">(null);
  const [seed, setSeed] = useState(0);
  useFrame(() => {
    const e = eventRef.current;
    const k = e?.kind ?? null;
    if (k !== kind) {
      setKind(k);
      setSeed(e?.seed ?? 0);
    }
  });
  if (!kind) return null;
  if (kind === "star") return <StarEvent eventRef={eventRef} />;
  if (kind === "asteroids") return <AsteroidField eventRef={eventRef} seed={seed} />;
  if (kind === "wreck") return <WreckEvent eventRef={eventRef} />;
  if (kind === "chase") return <ChaseShip eventRef={eventRef} />;
  return null;
}

function StarEvent({ eventRef }: { eventRef: RareRef }) {
  const ref = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  useFrame((_, dt) => {
    const e = eventRef.current; if (!e || !ref.current) return;
    const p = e.t / e.duration; // 0..1, moves from far behind to behind us
    // approach from -40 to +20 along Z, side offset
    const z = -55 + p * 80;
    ref.current.position.set(7, 2.5, z);
    ref.current.rotation.y += dt * 0.1;
    if (lightRef.current) lightRef.current.intensity = 2.5 * (1 - Math.abs(0.5 - p) * 2);
  });
  return (
    <group ref={ref}>
      <mesh>
        <sphereGeometry args={[4.5, 32, 32]} />
        <meshBasicMaterial color="#ffd070" />
      </mesh>
      <mesh>
        <sphereGeometry args={[5.4, 32, 32]} />
        <meshBasicMaterial color="#ff8040" transparent opacity={0.35} />
      </mesh>
      <mesh>
        <sphereGeometry args={[6.6, 24, 24]} />
        <meshBasicMaterial color="#ff5020" transparent opacity={0.15} />
      </mesh>
      <pointLight ref={lightRef} color="#ffb060" intensity={2.2} distance={50} />
    </group>
  );
}

function AsteroidField({ eventRef, seed }: { eventRef: RareRef; seed: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const COUNT = 40;
  const data = useMemo(() => {
    const rng = mulberry(seed * 9301 + 1);
    return Array.from({ length: COUNT }, () => ({
      x: (rng() - 0.5) * 14,
      y: (rng() - 0.5) * 7,
      zStart: -50 - rng() * 30,
      scale: 0.3 + rng() * 0.9,
      rotSpd: (rng() - 0.5) * 1.2,
      phase: rng() * Math.PI * 2,
    }));
  }, [seed]);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  useFrame((_, dt) => {
    const e = eventRef.current; if (!e || !meshRef.current) return;
    const p = e.t / e.duration;
    for (let i = 0; i < COUNT; i++) {
      const d = data[i];
      const z = d.zStart + p * 110;
      tmp.position.set(d.x + Math.sin(e.t * 0.01 + d.phase) * 0.3, d.y, z);
      tmp.rotation.set(e.t * 0.01 * d.rotSpd, e.t * 0.013 * d.rotSpd, 0);
      tmp.scale.setScalar(d.scale);
      tmp.updateMatrix();
      meshRef.current.setMatrixAt(i, tmp.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    void dt;
  });
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, COUNT]}>
      <dodecahedronGeometry args={[0.6, 0]} />
      <meshStandardMaterial color="#7a6a5a" roughness={1} flatShading />
    </instancedMesh>
  );
}

function WreckEvent({ eventRef }: { eventRef: RareRef }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const e = eventRef.current; if (!e || !ref.current) return;
    const p = e.t / e.duration;
    const z = -50 + p * 75;
    ref.current.position.set(-3, -1.2, z);
    ref.current.rotation.z = Math.sin(e.t * 0.02) * 0.08 - 0.3;
    ref.current.rotation.y += dt * 0.05;
  });
  return (
    <group ref={ref}>
      {/* hull */}
      <mesh>
        <cylinderGeometry args={[1.1, 1.4, 8, 12]} />
        <meshStandardMaterial color="#3a3a44" metalness={0.7} roughness={0.6} />
      </mesh>
      {/* broken nose */}
      <mesh position={[0, 4.2, 0.3]} rotation={[0.4, 0, 0]}>
        <coneGeometry args={[1.0, 2.2, 10]} />
        <meshStandardMaterial color="#2c2c32" metalness={0.8} roughness={0.5} />
      </mesh>
      {/* exposed wing */}
      <mesh position={[2.4, -1, 0]} rotation={[0, 0, 0.6]}>
        <boxGeometry args={[3.2, 0.2, 1.2]} />
        <meshStandardMaterial color="#444450" metalness={0.6} roughness={0.7} />
      </mesh>
      {/* glowing reactor leak */}
      <pointLight color="#60ffd0" intensity={1.4} distance={14} position={[0, -3, 0]} />
      <mesh position={[0, -3.5, 0]}>
        <sphereGeometry args={[0.6, 16, 16]} />
        <meshBasicMaterial color="#a0ffe0" />
      </mesh>
      {/* sparks */}
      <mesh position={[1.2, 0.8, 0.5]}>
        <sphereGeometry args={[0.18, 8, 8]} />
        <meshBasicMaterial color="#ffaa30" />
      </mesh>
    </group>
  );
}

function ChaseShip({ eventRef }: { eventRef: RareRef }) {
  const ref = useRef<THREE.Group>(null);
  const blinkRef = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((_, dt) => {
    const e = eventRef.current; if (!e || !ref.current) return;
    const p = e.t / e.duration;
    // Stays ahead, drifting up/down, occasionally darts left/right
    const z = -28 + Math.sin(p * Math.PI * 2) * 6;
    const x = Math.sin(e.t * 0.02) * 2.5;
    const y = 1 + Math.sin(e.t * 0.015) * 1.5;
    ref.current.position.set(x, y, z);
    ref.current.rotation.y = Math.PI + Math.sin(e.t * 0.03) * 0.4;
    if (blinkRef.current) blinkRef.current.opacity = 0.5 + 0.5 * Math.sin(e.t * 0.3);
    void dt;
  });
  return (
    <group ref={ref}>
      <mesh>
        <coneGeometry args={[0.5, 2.0, 8]} />
        <meshStandardMaterial color="#202028" metalness={0.9} roughness={0.2} />
      </mesh>
      <mesh position={[0, -0.1, 0.3]}>
        <boxGeometry args={[2.2, 0.1, 0.6]} />
        <meshStandardMaterial color="#2a2a36" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.9]}>
        <sphereGeometry args={[0.22, 12, 8]} />
        <meshBasicMaterial color="#ff3050" />
      </mesh>
      <mesh position={[0, 0, 1.1]}>
        <sphereGeometry args={[0.45, 12, 8]} />
        <meshBasicMaterial ref={blinkRef} color="#ff3050" transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

function mulberry(seed: number) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
