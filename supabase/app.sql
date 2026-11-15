-- משפט יומי: הרשאות לממשק ודירוג משפטים
-- מריצים בעורך ה-SQL של Supabase אחרי schema.sql, holidays.sql ו-functions.sql.
-- אפשר להריץ שוב בבטחה.

-- ---------- הרשאות למשתמש מחובר ----------
-- ה-RLS כבר מגביל כל משתמש לנתונים שלו. כאן רק מוודאים שלמשתמש מחובר יש גישה לטבלאות.
grant usage on schema public to authenticated;

grant select, insert, update, delete on
  public.settings,
  public.categories,
  public.user_categories,
  public.sentences,
  public.blocked_dates,
  public.style_profiles
to authenticated;

-- היסטוריית השליחות: המשתמש קורא ומדרג, אבל לא יוצר ולא מוחק שליחות.
grant select, update on public.sends to authenticated;

grant select on public.holidays to authenticated;

-- ---------- ציון למשפט ----------
-- הציון מחושב מחדש בכל שינוי דירוג או תגובה:
--   אגודל למעלה מהמשתמש: +2. אגודל למטה: -2. תגובה או תשובה מהנמען: +1.
-- משפט שהציון שלו יורד ל- -2 ומטה עובר למצב מושהה. המשתמש יכול להחזיר אותו.
create or replace function public.recompute_sentence_score()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_score int;
begin
  if new.sentence_id is null then
    return new;
  end if;

  select coalesce(sum(
           coalesce(user_rating, 0) * 2
           + (recipient_reaction is not null or recipient_replied)::int
         ), 0)
    into v_score
    from public.sends
   where sentence_id = new.sentence_id;

  update public.sentences
     set score  = v_score,
         status = case when v_score <= -2 and status = 'active' then 'paused' else status end
   where id = new.sentence_id;

  -- מונה דירוגים: לפיו ה-AI יידע מתי לעדכן את סיכום הסגנון.
  if new.user_rating is distinct from old.user_rating then
    update public.style_profiles
       set ratings_since_update = ratings_since_update + 1
     where user_id = new.user_id;
  end if;

  return new;
end;
$$;

-- ניקוי גרסה קודמת של מנגנון הדירוג, אם הותקנה.
drop trigger if exists sends_apply_user_rating on public.sends;
drop function if exists public.apply_user_rating();

drop trigger if exists sends_recompute_score on public.sends;
create trigger sends_recompute_score
  after update of user_rating, recipient_reaction, recipient_replied on public.sends
  for each row execute function public.recompute_sentence_score();

revoke all on function public.recompute_sentence_score() from public, anon, authenticated;
