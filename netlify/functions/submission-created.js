// Netlify runs this automatically every time a site form is submitted.
// It adds the person to the matching Flodesk segment.
// Netlify environment variable needed: FLODESK_API_KEY
// (Flodesk > profile icon > Integrations > API Keys)

const FLODESK = 'https://api.flodesk.com/v1';

// Find Your Fit routes by the "support" answer, per the funnel brief.
const SUPPORT_TO_SEGMENT = {
  '1:1 Private Coaching': 'Inquiry: Private Coaching',
  'Nutrition Strategy Call': 'Inquiry: Nutrition Strategy Call',
  'Custom Training Program': 'Inquiry: Custom Training',
  'Not sure': 'Inquiry: Find Your Fit',
};

const first = (v) => (Array.isArray(v) ? v[0] : v);
const clean = (v) => (first(v) || '').toString().trim();
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function headers() {
  return {
    Authorization: 'Basic ' + Buffer.from((process.env.FLODESK_API_KEY || '') + ':').toString('base64'),
    'Content-Type': 'application/json',
    'User-Agent': 'Meghan Elayne Coaching website (meghanelaynecoaching.com)',
  };
}

async function findSegmentId(name) {
  let page = 1, total = 1;
  do {
    const r = await fetch(`${FLODESK}/segments?page=${page}&per_page=100`, { headers: headers() });
    if (!r.ok) throw new Error(`segments lookup ${r.status}: ${await r.text()}`);
    const body = await r.json();
    const hit = (body.data || []).find((s) => norm(s.name) === norm(name));
    if (hit) return hit.id;
    total = (body.meta && body.meta.total_pages) || 1;
    page++;
  } while (page <= total);
  return null;
}

exports.handler = async (event) => {
  try {
    const payload = JSON.parse(event.body || '{}').payload || {};
    const data = payload.data || {};
    const formName = payload.form_name || clean(data['form-name']);
    const email = clean(data.email) || clean(payload.email);
    if (!email) { console.log(`"${formName}": no email, skipped`); return { statusCode: 200 }; }
    if (!process.env.FLODESK_API_KEY) throw new Error('FLODESK_API_KEY is not set in Netlify');

    let firstName = clean(data.first_name), lastName = '';
    if (!firstName && clean(data.full_name)) {
      const parts = clean(data.full_name).split(/\s+/);
      firstName = parts.shift(); lastName = parts.join(' ');
    }
    const segmentName = (formName === 'Inquiry - Find Your Fit' && SUPPORT_TO_SEGMENT[clean(data.support)]) || clean(data.segment);
    if (!segmentName) { console.log(`"${formName}": no segment, email only, skipped Flodesk`); return { statusCode: 200 }; }
    const segmentId = await findSegmentId(segmentName);
    if (segmentName && !segmentId) console.error(`No Flodesk segment named "${segmentName}". Saved ${email} without a segment.`);

    const sub = { email, first_name: firstName || undefined, last_name: lastName || undefined };
    if (segmentId) sub.segment_ids = [segmentId];
    const r = await fetch(`${FLODESK}/subscribers`, { method: 'POST', headers: headers(), body: JSON.stringify(sub) });
    if (!r.ok) throw new Error(`subscriber ${r.status}: ${await r.text()}`);
    const created = await r.json().catch(() => ({}));
    const subId = created.id || email;
    console.log(`Flodesk subscriber ${subId} status: ${created.status || 'unknown'}, segments: ${(created.segments || []).map((s) => s.name).join(', ') || 'none'}`);

    if (segmentId) { // existing subscribers: make sure they join the segment
      const r2 = await fetch(`${FLODESK}/subscribers/${encodeURIComponent(subId)}/segments`, {
        method: 'POST', headers: headers(), body: JSON.stringify({ segment_ids: [segmentId] }),
      });
      if (!r2.ok)
