-- Migration: 002_fix_names
-- Fix spelling mistake in signer name: from 'רווי' to 'רווח'
UPDATE amana_signatures
SET name = 'אביה רווח'
WHERE name = 'אביה רווי' 
   OR name LIKE '%אביה רווי%' 
   OR name LIKE '%רווי%';
