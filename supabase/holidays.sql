-- משפט יומי: לוח חגים משותף לכל המשתמשים
-- מריצים בעורך ה-SQL של Supabase אחרי schema.sql, ולפני functions.sql המעודכן.
-- אפשר להריץ שוב בבטחה.
--
-- החגים נשמרים פעם אחת לכולם. כל משתמש קובע בהגדרות אילו סוגים לחסום,
-- ויכול לבטל חסימה של יום מסוים דרך blocked_dates (send_anyway = true).
-- מקור התאריכים: Hebcal, לוח ישראל. יש לרענן פעם בשנה.

create table if not exists public.holidays (
  holiday_date  date not null,
  name          text not null,
  kind          text not null check (kind in ('holiday', 'holiday_eve', 'memorial')),
  primary key (holiday_date, kind)
);

alter table public.holidays enable row level security;

drop policy if exists "everyone reads holidays" on public.holidays;
create policy "everyone reads holidays" on public.holidays
  for select using (true);

-- ימי זיכרון ואבל (יום השואה, יום הזיכרון, תשעה באב) נחסמים כברירת מחדל.
alter table public.settings
  add column if not exists block_memorial_days boolean not null default true;

insert into public.holidays (holiday_date, name, kind) values
  -- 2027 (תשפ"ז / תשפ"ח)
  ('2027-04-21', 'ערב פסח',                  'holiday_eve'),
  ('2027-04-22', 'פסח',                      'holiday'),
  ('2027-04-27', 'ערב שביעי של פסח',         'holiday_eve'),
  ('2027-04-28', 'שביעי של פסח',             'holiday'),
  ('2027-05-04', 'יום השואה',                'memorial'),
  ('2027-05-11', 'יום הזיכרון',              'memorial'),
  ('2027-06-10', 'ערב שבועות',               'holiday_eve'),
  ('2027-06-11', 'שבועות',                   'holiday'),
  ('2027-08-12', 'תשעה באב',                 'memorial'),
  ('2027-10-01', 'ערב ראש השנה',             'holiday_eve'),
  ('2027-10-02', 'ראש השנה',                 'holiday'),
  ('2027-10-03', 'ראש השנה, יום שני',        'holiday'),
  ('2027-10-10', 'ערב יום כיפור',            'holiday_eve'),
  ('2027-10-11', 'יום כיפור',                'holiday'),
  ('2027-10-15', 'ערב סוכות',                'holiday_eve'),
  ('2027-10-16', 'סוכות',                    'holiday'),
  ('2027-10-22', 'הושענא רבה, ערב שמחת תורה', 'holiday_eve'),
  ('2027-10-23', 'שמחת תורה',                'holiday')
on conflict (holiday_date, kind) do update set name = excluded.name;
