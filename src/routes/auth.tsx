import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
  head: () => ({
    meta: [
      { title: "Вход — SPACE RUSH" },
      { name: "description", content: "Войдите или зарегистрируйтесь, чтобы сохранять рекорды." },
    ],
  }),
});

function AuthPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // OTP step (after signup)
  const [needOtp, setNeedOtp] = useState(false);
  const [otp, setOtp] = useState("");

  useEffect(() => {
    if (user) navigate({ to: "/", replace: true });
  }, [user, navigate]);

  function translateError(raw: string): string {
    const lower = raw.toLowerCase();
    if (lower.includes("invalid login credentials")) return "Неверный email или пароль";
    if (lower.includes("invalid") && lower.includes("email")) return "Неверный формат email";
    if (lower.includes("already registered")) return "Такой email уже зарегистрирован — войдите";
    if (lower.includes("password") && (lower.includes("short") || lower.includes("6"))) return "Пароль слишком короткий (мин. 6 символов)";
    if (lower.includes("weak") || lower.includes("pwned") || lower.includes("compromised")) return "Этот пароль слишком простой или утёк в сеть. Придумайте другой.";
    if (lower.includes("email not confirmed")) return "Подтвердите email кодом, который пришёл на почту";
    if (lower.includes("rate limit")) return "Слишком много попыток, подождите немного";
    if (lower.includes("token") && lower.includes("expired")) return "Код истёк — запросите новый";
    if (lower.includes("invalid") && lower.includes("token")) return "Неверный код";
    if (lower.includes("otp")) return "Неверный или просроченный код";
    return raw || "Что-то пошло не так";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { display_name: displayName || email.split("@")[0] },
          },
        });
        if (error) throw error;
        setNeedOtp(true);
        setMsg("Мы отправили 6-значный код на " + email + ". Введите его ниже.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/", replace: true });
      }
    } catch (e) {
      setErr(translateError(e instanceof Error ? e.message : ""));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: otp.trim(),
        type: "signup",
      });
      if (error) throw error;
      navigate({ to: "/", replace: true });
    } catch (e) {
      setErr(translateError(e instanceof Error ? e.message : ""));
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setErr(null);
    setMsg(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email });
      if (error) throw error;
      setMsg("Новый код отправлен на " + email);
    } catch (e) {
      setErr(translateError(e instanceof Error ? e.message : ""));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-black px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-md">
        <h1 className="text-2xl font-bold tracking-wider text-white">
          {needOtp ? "Подтверждение email" : mode === "signin" ? "Вход" : "Регистрация"}
        </h1>
        <p className="mt-1 text-sm text-white/60">
          {needOtp ? "Введите код из письма" : "Сохраняй рекорды, дистанцию и прогресс"}
        </p>

        {needOtp ? (
          <form onSubmit={handleVerifyOtp} className="mt-5 flex flex-col gap-3">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              placeholder="6-значный код"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              className="rounded-md border border-white/15 bg-black/40 px-3 py-2 text-center text-lg tracking-[0.5em] text-white placeholder:text-white/40 outline-none focus:border-white/40"
            />

            {err && <div className="rounded-md bg-red-500/20 px-3 py-2 text-xs text-red-200">{err}</div>}
            {msg && <div className="rounded-md bg-emerald-500/20 px-3 py-2 text-xs text-emerald-200">{msg}</div>}

            <button
              type="submit"
              disabled={loading || otp.length < 6}
              className="mt-1 rounded-md bg-white px-4 py-2 text-sm font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
            >
              {loading ? "..." : "Подтвердить"}
            </button>
            <button
              type="button"
              onClick={handleResend}
              disabled={loading}
              className="text-xs text-white/60 hover:text-white"
            >
              Отправить код ещё раз
            </button>
            <button
              type="button"
              onClick={() => { setNeedOtp(false); setOtp(""); setErr(null); setMsg(null); }}
              className="text-xs text-white/40 hover:text-white/70"
            >
              ← Назад
            </button>
          </form>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
              {mode === "signup" && (
                <input
                  type="text"
                  placeholder="Никнейм"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="rounded-md border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40"
                />
              )}
              <input
                type="email"
                required
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-md border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40"
              />
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={6}
                  placeholder="Пароль (мин. 6 символов)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 pr-16 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-white/60 hover:bg-white/10 hover:text-white"
                  aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                >
                  {showPassword ? "Скрыть" : "Показ."}
                </button>
              </div>

              {err && <div className="rounded-md bg-red-500/20 px-3 py-2 text-xs text-red-200">{err}</div>}
              {msg && <div className="rounded-md bg-emerald-500/20 px-3 py-2 text-xs text-emerald-200">{msg}</div>}

              <button
                type="submit"
                disabled={loading}
                className="mt-1 rounded-md bg-white px-4 py-2 text-sm font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
              >
                {loading ? "..." : mode === "signin" ? "Войти" : "Создать аккаунт"}
              </button>
            </form>

            <button
              onClick={() => { setErr(null); setMsg(null); setMode(mode === "signin" ? "signup" : "signin"); }}
              className="mt-4 w-full text-center text-xs text-white/60 hover:text-white"
            >
              {mode === "signin" ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти"}
            </button>

            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-[10px] uppercase tracking-widest text-white/40">или</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            <button
              type="button"
              disabled={loading}
              onClick={async () => {
                setErr(null);
                setLoading(true);
                try {
                  const result = await lovable.auth.signInWithOAuth("google", {
                    redirect_uri: window.location.origin,
                  });
                  if (result.error) throw new Error(result.error.message || "Google sign-in failed");
                  if (result.redirected) return;
                  navigate({ to: "/", replace: true });
                } catch (e) {
                  setErr(translateError(e instanceof Error ? e.message : ""));
                  setLoading(false);
                }
              }}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50"
            >
              <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c3 0 5.7 1.1 7.7 2.9l5.7-5.7C33.9 6.5 29.2 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.4-.4-3.5z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12.5 24 12.5c3 0 5.7 1.1 7.7 2.9l5.7-5.7C33.9 6.5 29.2 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 43.5c5.1 0 9.7-1.9 13.2-5.1l-6.1-5c-2 1.4-4.5 2.1-7.1 2.1-5.3 0-9.7-3.1-11.3-7.4l-6.5 5C9.6 39 16.3 43.5 24 43.5z"/>
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4-4.1 5.4l6.1 5c-.4.4 6.7-4.9 6.7-14.4 0-1.2-.1-2.4-.4-3.5z"/>
              </svg>
              Войти через Google
            </button>
          </>
        )}

        <div className="mt-4 text-center">
          <Link to="/" className="text-xs text-white/40 hover:text-white/70">← В игру</Link>
        </div>
      </div>
    </div>
  );
}
