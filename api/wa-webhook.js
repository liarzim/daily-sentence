// מקבל אירועים נכנסים מ-Green API (או מכל ספק עתידי שמתורגם לאותו מבנה)
// ומעביר למסד. כל ההחלטות נשארות ב-record_reaction.
// משתני סביבה ב-Vercel (שרת בלבד): SUPABASE_URL, SUPABASE_SECRET_KEY, WEBHOOK_SECRET

export function parseEvent(body) {
  const type = body?.typeWebhook;
  if (type !== 'incomingMessageReceived' && type !== 'outgoingMessageReceived') return null;
  const md = body.messageData || {};
  const chat = String(body.senderData?.chatId || '').split('@')[0];
  // אירוע יוצא נחשב רק בצ'אט עם עצמך (בדיקות); בצ'אט של נמען זו תגובה שלך ולא שלו
  if (type === 'outgoingMessageReceived') {
    const own = String(body.instanceData?.wid || '').split('@')[0];
    if (!own || own !== chat) return null;
  }
  const quoted = md.quotedMessage?.stanzaId || null;
  if (md.typeMessage === 'reactionMessage') {
    const emoji = md.extendedTextMessageData?.text || null;
    return emoji ? { waMessageId: quoted, chat, emoji } : null; // הסרת תגובה: מתעלמים
  }
  return { waMessageId: quoted, chat, emoji: null };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (req.query?.s !== process.env.WEBHOOK_SECRET) return res.status(401).end();

  const ev = parseEvent(req.body);
  if (!ev) return res.status(200).json({ ignored: true });

  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/record_reaction`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_wa_message_id: ev.waMessageId, p_chat_phone: ev.chat, p_emoji: ev.emoji }),
  });
  if (!r.ok) return res.status(502).json({ error: 'db' });
  return res.status(200).json(await r.json());
}
