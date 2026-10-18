-- Migration: 003_cleanup_fake_and_duplicates
-- 1. Delete duplicate signature for sari.vlado@gmail.com (id 5, keeping id 6)
DELETE FROM amana_signatures 
WHERE id = 5 
   OR (email = 'sari.vlado@gmail.com' AND name = 'שרי ליבוביץ' AND id != 6);

-- 2. Delete all 23 fabricated alphabet signatures (someone signed every letter of the Hebrew alphabet)
DELETE FROM amana_signatures 
WHERE email IN (
  'k5412954@gmail.com',
  'shnews@gmail.com',
  '41455@gmail.com',
  'pninapfaa@gmail.com',
  '741542@gmail.com',
  '874152@gmail.com',
  'ews@gmail.com',
  '4124@gmail.com',
  '414889@gmail.com',
  '412365@gmail.com',
  '4125896@gmail.com',
  '87412@gmail.com',
  '4155854@gmail.com',
  '82824@gmail.com',
  'k028542333@gmail.com',
  'k0485696@gmail.com',
  '855595@gmail.com',
  '8333@gmail.com',
  '68154@gmail.com',
  '755594@gmail.com',
  '74554@gmail.com',
  '8555595@gmail.com',
  '74555954@gmail.com'
)
OR id IN (63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86);

-- 3. Restore correct name for Sara Molayem Horwitz (was incorrectly modified by wildcard '%רווי%')
UPDATE amana_signatures 
SET name = 'שרה מולאים הורוויץ' 
WHERE email = 'saramolayemhorwitz@gmail.com';

-- 4. Clean any test, dummy, or empty rows
DELETE FROM amana_signatures 
WHERE name ILIKE '%בדיקה%' 
   OR name ILIKE '%check%' 
   OR name ILIKE '%test%' 
   OR email ILIKE '%test%' 
   OR email ILIKE '%example.com%' 
   OR email ILIKE '%check%' 
   OR email = '123@1.1' 
   OR TRIM(name) = '' 
   OR TRIM(email) = '';
