
CREATE TABLE public.daily_rewards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  claim_date DATE NOT NULL,
  reward_coins INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, claim_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_rewards TO authenticated;
GRANT ALL ON public.daily_rewards TO service_role;

ALTER TABLE public.daily_rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own daily rewards"
ON public.daily_rewards FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users insert own daily rewards"
ON public.daily_rewards FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own daily rewards"
ON public.daily_rewards FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users delete own daily rewards"
ON public.daily_rewards FOR DELETE
USING (auth.uid() = user_id);

CREATE TRIGGER update_daily_rewards_updated_at
BEFORE UPDATE ON public.daily_rewards
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_daily_rewards_user_date ON public.daily_rewards(user_id, claim_date DESC);
