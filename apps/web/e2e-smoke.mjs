import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

// Screenshots land next to the script by default; override with E2E_SHOTS.
const shots = process.env.E2E_SHOTS ?? new URL('./e2e-shots', import.meta.url).pathname;
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({
  // CHROMIUM_PATH lets CI/sandboxes point at a preinstalled browser.
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

/**
 * Every check below must be able to FAIL. An earlier revision of this script
 * only `console.log`-ed the RBAC counts, so the two checks that matter most —
 * a nurse seeing no admin navigation and no download buttons — could never
 * turn the job red. `check()` exists so those stay assertions.
 */
function check(condition, message) {
  if (!condition) throw new Error(`SMOKE ASSERTION FAILED: ${message}`);
}

/**
 * Navigation labels come from NAV_GROUPS in components/shell.tsx. Clicks are
 * scoped to the <nav> so a card or heading elsewhere on the page carrying the
 * same words cannot satisfy (or ambiguate) the locator.
 */
function nav(label) {
  return page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label, exact: true });
}

// 1. Login as nurse
await page.goto('http://localhost:3000/login');
await page.fill('input[type=email]', 'nurse@bnp.health');
await page.fill('input[type=password]', 'NurseUser123!');
await page.screenshot({ path: `${shots}/01-login.png` });
await page.click('button:has-text("Sign in")');
await page.waitForURL('**/dashboard', { timeout: 15000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${shots}/02-dashboard.png` });
console.log('login+dashboard OK');

// 2. Ask the assistant an answerable question
await nav('Nursing Assistant').click();
await page.waitForURL('**/assistant');
await page.fill('input[placeholder*="alcohol"]', 'What is the IV paracetamol dose for a patient under 50 kg?');
await page.click('button:has-text("Ask")');
await page.waitForSelector('text=Approved sources', { timeout: 20000 });
await page.screenshot({ path: `${shots}/03-assistant-answer.png` });
console.log('assistant cited answer OK');

// 3. Ask an unanswerable question -> Arabic refusal
await page.fill('input[placeholder*="alcohol"]', 'What is the chemotherapy protocol for lung cancer?');
await page.click('button:has-text("Ask")');
await page.waitForSelector('text=لا توجد وثيقة معتمدة كافية للإجابة', { timeout: 20000 });
await page.screenshot({ path: `${shots}/04-assistant-refusal.png` });
console.log('refusal rendering OK');

// 4. Dose calculator. Fields are addressed by their visible label rather than
// by input index, so reordering the form cannot silently repoint "weight" at
// "concentration" and still pass.
await nav('Dose Calculator').click();
await page.waitForURL('**/dose-calculator');
await page.getByLabel('Weight (kg)').fill('20');
await page.getByLabel('Concentration (mg/mL)').fill('10');
await page.click('button:has-text("Calculate dose")');
await page.waitForSelector('text=لا يعتمد هذا الحساب', { timeout: 15000 });
await page.screenshot({ path: `${shots}/05-dose-calculator.png` });
console.log('dose calculator OK');

// 5. Policies library. DOCUMENTS_DOWNLOAD is deliberately withheld from
// NURSE_USER — nurses read cited answers, they do not copy source PDFs — so
// zero download buttons is a governance control, not a cosmetic detail.
await nav('Policies Library').click();
await page.waitForSelector('text=Hand Hygiene', { timeout: 15000 });
const downloadButtons = await page.locator('button:has-text("Download")').count();
check(downloadButtons === 0, `nurse sees ${downloadButtons} Download button(s), expected 0`);
await page.screenshot({ path: `${shots}/06-policies.png` });
console.log('policies OK, no download buttons for nurse');

// 6. Nurse must NOT see admin nav items.
for (const label of ['Users & Roles', 'Audit Log', 'Upload Document']) {
  const visible = await nav(label).count();
  check(visible === 0, `nav "${label}" is visible to a nurse (found ${visible})`);
}
console.log('admin navigation hidden from nurse OK');

// 7. Login as knowledge manager -> approvals screen. The seeded corpus is
// entirely ACTIVE, so the default "Needs your action" filter is legitimately
// empty; switch to "All documents" before asserting a title is listed.
await page.click('button:has-text("Sign out")');
await page.waitForURL('**/login');
await page.fill('input[type=email]', 'knowledge@bnp.health');
await page.fill('input[type=password]', 'Knowledge123!');
await page.click('button:has-text("Sign in")');
await page.waitForURL('**/dashboard', { timeout: 15000 });

// The inverse of step 6, and the reason step 6 means anything: the same
// locator that found nothing for a nurse must find this for a knowledge
// manager. Without it, a locator that silently matched nothing would make the
// nurse's hidden-nav assertions pass vacuously.
const kmUpload = await nav('Upload Document').count();
check(kmUpload === 1, `knowledge manager sees ${kmUpload} "Upload Document" nav items, expected 1`);

await nav('Approval Workflow').click();
await page.waitForURL('**/approvals');
await page
  .getByRole('group', { name: 'Filter documents' })
  .getByRole('button', { name: /All documents/ })
  .click();
await page.waitForSelector('text=Peripheral IV Cannulation', { timeout: 15000 });
await page.screenshot({ path: `${shots}/07-approvals.png` });
console.log('approval workflow screen OK');

// 8. Arabic / RTL. Asserts the layout actually mirrors, not just that the text
// changed: `dir="rtl"` with a sidebar still pinned left is the classic
// half-done RTL, and it looks fine in a diff. Comparing the sidebar's x
// against the viewport midpoint catches it.
await page.click('button[aria-label="التبديل إلى العربية"]');
await page.waitForTimeout(400);
check(
  (await page.getAttribute('html', 'dir')) === 'rtl',
  'switching to Arabic sets dir="rtl" on <html>',
);
check(
  (await page.getAttribute('html', 'lang')) === 'ar',
  'switching to Arabic sets lang="ar" on <html>',
);
const arabicNav = page.getByRole('navigation', { name: 'التنقل الرئيسي' });
check((await arabicNav.count()) === 1, 'navigation is labelled in Arabic');
const asideBox = await page.locator('aside').boundingBox();
check(
  asideBox !== null && asideBox.x > 720,
  `sidebar mirrors to the right under RTL (x=${asideBox ? Math.round(asideBox.x) : 'null'})`,
);
await page.screenshot({ path: `${shots}/08-arabic-rtl.png` });

// The preference must survive a full reload, applied before first paint by
// LANG_INIT — otherwise every navigation flashes LTR and snaps back.
await page.reload();
await page.waitForTimeout(600);
check(
  (await page.getAttribute('html', 'dir')) === 'rtl',
  'Arabic preference survives a reload',
);

// And back, so a wrong toggle is recoverable.
await page.click('button[aria-label="Switch to English"]');
await page.waitForTimeout(400);
check(
  (await page.getAttribute('html', 'dir')) === 'ltr',
  'switching back to English restores dir="ltr"',
);
console.log('language switching + RTL mirroring OK');

await browser.close();
console.log('SMOKE PASSED');
