ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS wallet integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS owned_skins text[] NOT NULL DEFAULT ARRAY['classic']::text[],
  ADD COLUMN IF NOT EXISTS owned_maps text[] NOT NULL DEFAULT ARRAY['space']::text[],
  ADD COLUMN IF NOT EXISTS selected_skin text NOT NULL DEFAULT 'classic',
  ADD COLUMN IF NOT EXISTS selected_map text NOT NULL DEFAULT 'space';