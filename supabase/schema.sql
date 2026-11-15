-- משפט יומי בוואטסאפ: מבנה הנתונים
-- מריצים פעם אחת בעורך ה-SQL של Supabase.
-- כל טבלה שייכת למשתמש (user_id), וכל משתמש רואה רק את הנתונים שלו (RLS).
-- Make מתחבר עם מפתח השירות (service role) ולכן עוקף את ה-RLS.

-- ---------- הגדרות המשתמש ----------
create table if not exists public.settings (
  user_id               uuid primary key references auth.users (id) on delete cascade,
  recipient_name        text,
  recipient_phone       text,                       -- בפורמט בינלאומי, ספרות בלבד
  sender_gender         text check (sender_gender in ('male', 'female')),
  recipient_gender      text check (recipient_gender in ('male', 'female')),
  relationship_type     text not null default 'partner'
                        check (relationship_type in ('partner', 'parent', 'child', 'friend', 'other')),
  send_days             smallint[] not null default '{0,1,2,3,4}',  -- 0 = ראשון ... 6 = שבת
  window_start_hour     smallint not null default 8  check (window_start_hour between 0 and 23),
  window_end_hour       smallint not null default 15 check (window_end_hour between 1 and 24),
  timezone              text not null default 'Asia/Jerusalem',
  block_holidays        boolean not null default true,
  block_holiday_eves    boolean not null default false,
  block_shabbat         boolean not null default true,
  is_active             boolean not null default false,
  skip_date             date,                       -- "דילוג על היום"
  erotica_enabled       boolean not null default false,
  erotica_level         smallint not null default 1 check (erotica_level between 1 and 5),
  erotica_start_hour    smallint not null default 20 check (erotica_start_hour between 0 and 23),
  erotica_end_hour      smallint not null default 22 check (erotica_end_hour between 1 and 24),
  adult_confirmed       boolean not null default false,  -- הצהרת גיל 18 ומעלה
  updated_at            timestamptz not null default now(),
  check (window_end_hour > window_start_hour),
  check (erotica_end_hour > erotica_start_hour)
);

-- ---------- קטגוריות ----------
-- user_id ריק = קטגוריית מערכת שמוצעת לכולם. user_id מלא = קטגוריה שהמשתמש הוסיף.
create table if not exists public.categories (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid references auth.users (id) on delete cascade,
  name                  text not null,
  description           text,                       -- משמש גם כהנחיה ל-AI
  is_adult              boolean not null default false,
  partner_only          boolean not null default false,
  created_at            timestamptz not null default now()
);
create unique index if not exists categories_system_name on public.categories (name) where user_id is null;
create unique index if not exists categories_user_name on public.categories (user_id, name) where user_id is not null;

-- אילו קטגוריות כל משתמש הפעיל
create table if not exists public.user_categories (
  user_id               uuid not null references auth.users (id) on delete cascade,
  category_id           uuid not null references public.categories (id) on delete cascade,
  enabled               boolean not null default true,
  primary key (user_id, category_id)
);

-- ---------- מאגר המשפטים ----------
create table if not exists public.sentences (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  category_id           uuid not null references public.categories (id) on delete restrict,
  text                  text not null,
  source                text not null default 'manual' check (source in ('manual', 'ai')),
  status                text not null default 'active' check (status in ('active', 'paused')),
  score                 integer not null default 0,
  erotica_level         smallint check (erotica_level between 1 and 5),
  is_experiment         boolean not null default false,  -- משפט ניסיוני בסגנון חדש
  last_sent_at          timestamptz,
  created_at            timestamptz not null default now()
);
create index if not exists sentences_pick on public.sentences (user_id, status, last_sent_at);

-- ---------- היסטוריית שליחות ----------
create table if not exists public.sends (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  sentence_id           uuid references public.sentences (id) on delete set null,
  send_date             date not null,
  planned_hour          smallint,
  sent_at               timestamptz,
  wa_message_id         text,                       -- מקשר תגובת נמען להודעה
  status                text not null default 'sent' check (status in ('sent', 'skipped', 'failed')),
  skip_reason           text,
  user_rating           smallint check (user_rating in (-1, 1)),
  user_note             text,
  recipient_reaction    text,                       -- האימוג'י שהנמען הגיב בו
  recipient_replied     boolean not null default false,
  created_at            timestamptz not null default now(),
  unique (user_id, send_date)
);
create index if not exists sends_wa_message on public.sends (wa_message_id);

-- ---------- ימים ללא שליחה ----------
create table if not exists public.blocked_dates (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  blocked_date          date not null,
  description           text,
  source                text not null default 'manual' check (source in ('holiday', 'holiday_eve', 'manual')),
  send_anyway           boolean not null default false,  -- "לשלוח בכל זאת"
  created_at            timestamptz not null default now(),
  unique (user_id, blocked_date, source)
);

-- ---------- פרופיל הסגנון ל-AI ----------
create table if not exists public.style_profiles (
  user_id               uuid primary key references auth.users (id) on delete cascade,
  base_instructions     text,
  learned_summary       text,
  ratings_since_update  integer not null default 0,
  updated_at            timestamptz not null default now()
);

-- ---------- הפרדת נתונים בין משתמשים (RLS) ----------
alter table public.settings        enable row level security;
alter table public.categories      enable row level security;
alter table public.user_categories enable row level security;
alter table public.sentences       enable row level security;
alter table public.sends           enable row level security;
alter table public.blocked_dates   enable row level security;
alter table public.style_profiles  enable row level security;

create policy "own settings" on public.settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "read system and own categories" on public.categories
  for select using (user_id is null or user_id = auth.uid());
create policy "manage own categories" on public.categories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own user_categories" on public.user_categories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own sentences" on public.sentences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own sends" on public.sends
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own blocked_dates" on public.blocked_dates
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own style_profile" on public.style_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- קטגוריות המערכת ----------
insert into public.categories (user_id, name, description, is_adult, partner_only) values
  (null, 'אהבה',          'הבעת אהבה ישירה וחמה',                          false, false),
  (null, 'זוגיות',        'השותפות, הדרך המשותפת, מה שנבנה יחד',            false, true),
  (null, 'השראה',         'משפט שנותן כוח ופרספקטיבה ליום',                 false, false),
  (null, 'הוקרה ותודה',   'תודה על דבר מסוים, גדול או קטן',                 false, false),
  (null, 'געגוע',         'אמצע היום ואני חושב עליך',                       false, false),
  (null, 'עידוד',         'חיזוק ליום קשה או לאתגר',                        false, false),
  (null, 'הומור',         'משפט קליל שמעלה חיוך',                           false, false),
  (null, 'זיכרון משותף',  'רגע מהעבר שכדאי להיזכר בו',                      false, false),
  (null, 'בוקר טוב',      'פתיחת יום חמה',                                  false, false),
  (null, 'ארוטיקה',       'תשוקה ומשיכה, לפי הרמה שהמשתמש בחר (1 עד 5)',    true,  true)
on conflict do nothing;
