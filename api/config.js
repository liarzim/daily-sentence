// מחזיר לדפדפן את כתובת המסד ואת המפתח הציבורי בלבד.
// שניהם מיועדים לצד הלקוח: ההגנה על הנתונים נעשית ב-RLS במסד.
// המפתח הסודי (service role) לעולם לא נשלח מכאן.
module.exports = (req, res) => {
  const env = process.env;
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key =
    env.SUPABASE_PUBLISHABLE_KEY ||
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    env.SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ url, key });
};
