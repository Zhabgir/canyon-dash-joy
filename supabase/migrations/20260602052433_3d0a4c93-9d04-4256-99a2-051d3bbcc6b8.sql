CREATE TABLE public.daily_quests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  quest_date date NOT NULL,
  quests jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, quest_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_quests TO authenticated;
GRANT ALL ON public.daily_quests TO service_role;

ALTER TABLE public.daily_quests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own daily quests"
ON public.daily_quests FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users insert own daily quests"
ON public.daily_quests FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own daily quests"
ON public.daily_quests FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users delete own daily quests"
ON public.daily_quests FOR DELETE
USING (auth.uid() = user_id);

CREATE TRIGGER update_daily_quests_updated_at
BEFORE UPDATE ON public.daily_quests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_daily_quests_user_date ON public.daily_quests(user_id, quest_date DESC);