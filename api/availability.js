// GET /api/availability?date=YYYY-MM-DD
// Returns the calendar's busy blocks for that day as minutes-from-midnight in
// the shop timezone, so the booking UI can grey out slots already taken by
// OTHER customers (not just this device's localStorage).
const {
  TZ, CALENDAR_ID, calendarClient, localToInstant, instantToLocalMinutes,
} = require('./_google');

module.exports = async (req, res) => {
  const date = (req.query && req.query.date) || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Bad or missing date' });
  }
  // Let the browser cache briefly; availability changes on the order of minutes.
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');

  const cal = calendarClient();
  if (!cal) return res.status(200).json({ busy: [] }); // not configured -> no server blocks

  try {
    const dayStart = localToInstant(date, 0, TZ);
    const dayEnd = localToInstant(date, 24 * 60, TZ);
    const fb = await cal.freebusy.query({
      requestBody: {
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        items: [{ id: CALENDAR_ID }],
      },
    });
    const raw = (((fb.data.calendars || {})[CALENDAR_ID] || {}).busy) || [];
    const busy = raw.map((p) => {
      const s = new Date(p.start), e = new Date(p.end);
      const startMin = Math.max(0, instantToLocalMinutes(s, TZ));
      const dur = Math.round((e - s) / 60000);
      const endMin = Math.min(24 * 60, startMin + dur);
      return { start: startMin, end: endMin };
    }).filter((x) => x.end > x.start);
    return res.status(200).json({ busy });
  } catch (e) {
    console.error('availability error', e && e.message);
    // Fail open: no server blocks rather than breaking the booking UI.
    return res.status(200).json({ busy: [] });
  }
};
