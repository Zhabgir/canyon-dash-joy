import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import {
  getSupabaseConfigError,
  isSupabaseConfigured,
  supabase,
} from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
  head: () => ({
    meta: [
      { title: "Вход - SPACE RUSH" },
      {
        name: "description",
        content: "Войдите или зарегистрируйтесь через Supabase Auth.",
      },
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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) navigate({ to: "/", replace: true });
  }, [user, navigate]);

  function translateError(raw: string): string {
    const lower = raw.toLowerCase();
    if (lower.includes("invalid login credentials")) return "Неверный email или пароль";
    if (lower.includes("invalid") && lower.includes("email")) return "Неверный формат email";
    if (lower.includes("already registered")) return "Такой email уже зарегистрирован. Войдите в аккаунт.";
    if (lower.includes("email not confirmed")) return "Подтвердите email по ссылке из письма.";
    if (lower.includes("password") && (lower.includes("short") || lower.includes("6"))) {
      return "Пароль слишком короткий. Минимум 6 символов.";
    }
    if (lower.includes("weak") || lower.includes("pwned") || lower.includes("compromised")) {
      return "Этот пароль слишком простой или уже встречался в утечках. Придумайте другой.";
    }
    if (lower.includes("rate limit")) return "Слишком много попыток. Подождите немного.";
    if (lower.includes("provider is not enabled")) return "Google-вход не включен в настройках Supabase.";
    return raw || "Что-то пошло не так";
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!isSupabaseConfigured) {
      setError(getSupabaseConfigError());
      return;
    }

    setLoading(true);

    try {
      const trimmedEmail = email.trim();

      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: {
              display_name: displayName.trim() || trimmedEmail.split("@")[0],
            },
          },
        });

        if (signUpError) throw signUpError;

        if (data.session) {
          navigate({ to: "/", replace: true });
          return;
        }

        setMessage("Аккаунт создан. Проверьте почту и подтвердите email.");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });

        if (signInError) throw signInError;
        navigate({ to: "/", replace: true });
      }
    } catch (caught) {
      setError(translateError(caught instanceof Error ? caught.message : ""));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setMessage(null);

    if (!isSupabaseConfigured) {
      setError(getSupabaseConfigError());
      return;
    }

    setLoading(true);

    try {
      const { error: googleError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/`,
        },
      });

      if (googleError) throw googleError;
    } catch (caught) {
      setError(translateError(caught instanceof Error ? caught.message : ""));
      setLoading(false);
    }
  }

  function switchMode() {
    setError(null);
    setMessage(null);
    setMode((current) => (current === "signin" ? "signup" : "signin"));
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-black px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-md">
        <h1 className="text-2xl font-bold tracking-wider text-white">
          {mode === "signin" ? "Вход" : "Регистрация"}
        </h1>
        <p className="mt-1 text-sm text-white/60">
          Используется только Supabase Auth. Пароли не сохраняются в приложении.
        </p>
        {!isSupabaseConfigured && (
          <div className="mt-4 rounded-md bg-amber-500/20 px-3 py-2 text-xs text-amber-100">
            Для входа добавьте VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY.
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
          {mode === "signup" && (
            <input
              type="text"
              placeholder="Никнейм"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="rounded-md border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40"
            />
          )}

          <input
            type="email"
            required
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-md border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40"
          />

          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={6}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              placeholder="Пароль (мин. 6 символов)"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 pr-20 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40"
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-white/60 hover:bg-white/10 hover:text-white"
              aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
            >
              {showPassword ? "Скрыть" : "Показ."}
            </button>
          </div>

          {error && <div className="rounded-md bg-red-500/20 px-3 py-2 text-xs text-red-200">{error}</div>}
          {message && <div className="rounded-md bg-emerald-500/20 px-3 py-2 text-xs text-emerald-200">{message}</div>}

          <button
            type="submit"
            disabled={loading || !isSupabaseConfigured}
            className="mt-1 rounded-md bg-white px-4 py-2 text-sm font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
          >
            {loading ? "..." : mode === "signin" ? "Войти" : "Создать аккаунт"}
          </button>
        </form>

        <button
          type="button"
          onClick={switchMode}
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
          disabled={loading || !isSupabaseConfigured}
          onClick={handleGoogleSignIn}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50"
        >
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c3 0 5.7 1.1 7.7 2.9l5.7-5.7C33.9 6.5 29.2 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12.5 24 12.5c3 0 5.7 1.1 7.7 2.9l5.7-5.7C33.9 6.5 29.2 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 43.5c5.1 0 9.7-1.9 13.2-5.1l-6.1-5c-2 1.4-4.5 2.1-7.1 2.1-5.3 0-9.7-3.1-11.3-7.4l-6.5 5C9.6 39 16.3 43.5 24 43.5z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4-4.1 5.4l6.1 5c-.4.4 6.7-4.9 6.7-14.4 0-1.2-.1-2.4-.4-3.5z" />
          </svg>
          Войти через Google
        </button>

        <div className="mt-4 text-center">
          <Link to="/" className="text-xs text-white/40 hover:text-white/70">
            Назад в игру
          </Link>
        </div>
      </div>
    </div>
  );
}
