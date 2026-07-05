import { DocumentCategory } from '@bnp/shared';

export interface SampleDoc {
  title: string;
  description: string;
  category: DocumentCategory;
  expiryMonths: number;
  pages: string[][];
}

/**
 * Demo-only clinical content used to exercise the full governance + RAG
 * pipeline. Not for real clinical use.
 */
export const SAMPLE_DOCS: SampleDoc[] = [
  {
    title: 'IV Paracetamol (Acetaminophen) Preparation and Administration Guide',
    description: 'Approved pharmacy guide for preparing and administering IV paracetamol.',
    category: DocumentCategory.MEDICATIONS,
    expiryMonths: 24,
    pages: [
      [
        'IV Paracetamol (Acetaminophen) Preparation and Administration Guide',
        'Section 1: Indications and Dosing.',
        'IV paracetamol is indicated for the short-term treatment of moderate pain and fever when the IV route is clinically justified.',
        'Adult and adolescent patients weighing more than 50 kg: administer 1000 mg every 6 hours as needed. The maximum daily dose is 4000 mg.',
        'Patients weighing 50 kg or less: administer 15 mg per kg per dose every 6 hours. The maximum daily dose is 60 mg per kg, not exceeding 3000 mg.',
        'Section 2: Preparation Steps.',
        '1. Perform hand hygiene and prepare a clean medication preparation area.',
        '2. Verify the medication order against the patient chart using the five rights of medication administration.',
        '3. Inspect the vial: the solution must be clear and colorless. Do not use if particulate matter or discoloration is present.',
        '4. IV paracetamol 10 mg per mL solution requires no dilution for doses of 1000 mg (100 mL vial).',
        '5. For doses below 1000 mg, withdraw the required volume aseptically into a sterile container.',
      ],
      [
        'Section 3: Administration.',
        '6. Administer as an intravenous infusion over 15 minutes.',
        '7. Label the infusion with drug name, dose, date, time, and your initials.',
        '8. Document administration immediately in the medication administration record.',
        'Section 4: Warnings and Precautions.',
        'Warning: Do not exceed the maximum daily dose of paracetamol from all routes combined. Overdose can cause severe hepatotoxicity.',
        'Warning: Use with caution in patients with hepatic impairment, chronic malnutrition, or dehydration.',
        'Caution: Verify that the patient is not receiving other paracetamol-containing products.',
        'Monitor liver function in prolonged use beyond 48 hours.',
      ],
    ],
  },
  {
    title: 'Hand Hygiene and Medication Administration Safety Policy',
    description: 'Hospital nursing policy for hand hygiene and safe medication administration.',
    category: DocumentCategory.NURSING_POLICIES,
    expiryMonths: 36,
    pages: [
      [
        'Hand Hygiene and Medication Administration Safety Policy',
        'Policy Number: NUR-POL-012. Applies to all nursing staff.',
        'Section 1: Hand Hygiene.',
        'All staff must perform hand hygiene according to the WHO five moments: before touching a patient, before clean or aseptic procedures, after body fluid exposure risk, after touching a patient, and after touching patient surroundings.',
        '1. Use alcohol-based hand rub for 20 to 30 seconds when hands are not visibly soiled.',
        '2. Wash hands with soap and water for 40 to 60 seconds when hands are visibly soiled or after caring for patients with Clostridioides difficile.',
        '3. Keep fingernails short and avoid artificial nails in clinical areas.',
      ],
      [
        'Section 2: Safe Medication Administration.',
        'Nurses must apply the five rights before every administration: right patient, right medication, right dose, right route, right time.',
        '1. Verify patient identity using two identifiers: full name and medical record number.',
        '2. Perform independent double checks for high-alert medications including insulin, heparin, and concentrated electrolytes.',
        '3. Never administer a medication prepared by another person unless it was prepared under direct observation.',
        '4. Document administration immediately after giving the medication, never before.',
        'Warning: Interruptions during medication preparation increase error risk. Use the designated quiet zone and wear the do-not-interrupt vest during preparation.',
      ],
    ],
  },
  {
    title: 'CBAHI Medication Management Standard MM-7 Summary',
    description: 'Summary of CBAHI accreditation requirements for medication management.',
    category: DocumentCategory.CBAHI,
    expiryMonths: 24,
    pages: [
      [
        'CBAHI Medication Management Standard MM-7 Summary',
        'Standard MM-7: The hospital safely manages high-alert medications.',
        'Requirement 1: The hospital maintains a list of high-alert medications, reviewed at least every two years by the pharmacy and therapeutics committee.',
        'Requirement 2: Concentrated electrolytes, including potassium chloride above 0.4 mEq per mL, are not stored in patient care areas except in defined critical areas with safeguards.',
        'Requirement 3: An independent double check by two licensed practitioners is required before administering high-alert medications.',
        'Requirement 4: Anticoagulant therapy requires a defined protocol covering initiation, monitoring, and reversal.',
        'Requirement 5: The hospital monitors and reports medication errors and adverse drug events through the incident reporting system.',
        'Evidence of compliance includes staff interviews, medication storage inspection, and review of double-check documentation.',
      ],
    ],
  },
  {
    title: 'Peripheral IV Cannulation Procedure',
    description: 'Step-by-step nursing procedure for peripheral intravenous cannula insertion.',
    category: DocumentCategory.PROCEDURES,
    expiryMonths: 24,
    pages: [
      [
        'Peripheral IV Cannulation Procedure',
        'Purpose: To establish safe peripheral venous access for fluid and medication administration.',
        'Section 1: Preparation.',
        '1. Verify the order and explain the procedure to the patient, obtaining verbal consent.',
        '2. Perform hand hygiene and gather equipment: cannula of appropriate gauge, tourniquet, antiseptic swabs, transparent dressing, extension set, and sharps container.',
        '3. Select a vein, preferably on the non-dominant forearm. Avoid areas of flexion, infected skin, and limbs with fistulas or lymphedema.',
        'Section 2: Insertion Steps.',
        '4. Apply the tourniquet 10 to 15 cm above the intended site.',
        '5. Disinfect the site with 2% chlorhexidine in 70% alcohol and allow it to dry for 30 seconds. Do not touch the site after disinfection.',
        '6. Insert the cannula bevel up at a 15 to 30 degree angle and observe for flashback.',
        '7. Advance the cannula, release the tourniquet, and secure with a sterile transparent dressing.',
        '8. Flush with 0.9% sodium chloride and label the dressing with date, time, and gauge.',
        'Warning: Never re-insert the needle into the cannula after withdrawal — this can shear the catheter and cause embolism.',
        'Caution: Replace peripheral cannulas when clinically indicated and inspect the site every shift for phlebitis using the VIP score.',
      ],
    ],
  },
];
