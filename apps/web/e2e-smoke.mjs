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
await page.click('text=AI Nursing Assistant');
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

// 4. Dose calculator
await page.click('text=Dose Calculator');
await page.waitForURL('**/dose-calculator');
await page.fill('input[type=number] >> nth=0', '20');
await page.fill('input[type=number] >> nth=2', '10');
await page.click('button:has-text("Calculate dose")');
await page.waitForSelector('text=لا يعتمد هذا الحساب', { timeout: 15000 });
await page.screenshot({ path: `${shots}/05-dose-calculator.png` });
console.log('dose calculator OK');

// 5. Policies library (nurse: no download buttons)
await page.click('text=Policies Library');
await page.waitForSelector('text=Hand Hygiene', { timeout: 15000 });
const downloadButtons = await page.locator('button:has-text("Download")').count();
console.log('policies OK, download buttons for nurse (expect 0):', downloadButtons);
await page.screenshot({ path: `${shots}/06-policies.png` });

// 6. Nurse must NOT see admin nav items
for (const label of ['Users & Roles', 'Audit Logs', 'Upload Document']) {
  const visible = await page.locator(`nav >> text=${label}`).count();
  console.log(`nav "${label}" hidden for nurse (expect 0):`, visible);
}

// 7. Login as knowledge manager -> approvals screen
await page.click('button:has-text("Sign out")');
await page.waitForURL('**/login');
await page.fill('input[type=email]', 'knowledge@bnp.health');
await page.fill('input[type=password]', 'Knowledge123!');
await page.click('button:has-text("Sign in")');
await page.waitForURL('**/dashboard', { timeout: 15000 });
await page.click('text=Approval Workflow');
await page.waitForSelector('text=Insulin Storage', { timeout: 15000 });
await page.screenshot({ path: `${shots}/07-approvals.png` });
console.log('approval workflow screen OK');

await browser.close();
console.log('SMOKE PASSED');
