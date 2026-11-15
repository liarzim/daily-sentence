-- משפט יומי: הדירוג של המשתמש משפיע על המאגר
-- מריצים בעורך ה-SQL של Supabase אחרי schema.sql. אפשר להריץ שוב בבטחה.
--
-- אגודל למעלה מוסיף 2 לציון המשפט, אגודל למטה מוריד 2.
-- משפט שהגיע לציון מינוס 2 ומטה עובר למצב מושהה. המשתמש יכול להחזיר אותו.

create or replace function public.apply_user_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta int;
begin
  if new.sentence_id is null then
    return new;
  end if;

  v_delta := (coalesce(new.user_rating, 0) - coalesce(old.user_rating, 0)) * 2;
  if v_delta = 0 then
    return new;
  end if;

  update public.sentences
     set score  = score + v_delta,
         status = case when score + v_delta <= -2 then 'paused' else status end
   where id = new.sentence_id and user_id = new.user_id;

  update public.style_profiles
     set ratings_since_update = ratings_since_update + 1
   where user_id = new.user_id;

  return new;
end;
$$;

drop trigger if exists sends_apply_user_rating on public.sends;
create trigger sends_apply_user_rating
  after update of user_rating on public.sends
  for each row
  when (old.user_rating is distinct from new.user_rating)
  execute function public.apply_user_rating();
