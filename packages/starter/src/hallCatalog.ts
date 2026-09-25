import { fromUnit, type ItemDefinition } from '@space-planner/core';

const m = (v: number) => fromUnit(v, 'm');
const cm = (v: number) => fromUnit(v, 'cm');
const none = { front: 0, back: 0, left: 0, right: 0 };

/**
 * Hall catalog for new projects: the common furniture of Egyptian event halls with real sizes.
 * Clearances are the room each item needs to be used (pulling a chair out, queueing at a buffet).
 * Ids are stable: saved projects and tests refer to them.
 */
export const STARTER_CATALOG: readonly ItemDefinition[] = [
  // Tables
  { id: 'round-120', name: 'ترابيزة مدورة ١٢٠ (٦ أفراد)', category: 'round-table', size: { w: cm(120), d: cm(120), h: cm(75) }, clearance: none, footprint: 'round' },
  { id: 'round-150', name: 'ترابيزة مدورة ١٥٠', category: 'round-table', size: { w: cm(150), d: cm(150), h: cm(75) }, clearance: none, footprint: 'round' },
  { id: 'round-180', name: 'ترابيزة مدورة ١٨٠ (١٠ أفراد)', category: 'round-table', size: { w: cm(180), d: cm(180), h: cm(75) }, clearance: none, footprint: 'round' },
  { id: 'table-180', name: 'ترابيزة ١٨٠×٨٠', category: 'table', size: { w: cm(180), d: cm(80), h: cm(75) }, clearance: { ...none, left: cm(60), right: cm(60) } },
  { id: 'table-240', name: 'ترابيزة ٢٤٠×٨٠', category: 'table', size: { w: cm(240), d: cm(80), h: cm(75) }, clearance: { ...none, left: cm(60), right: cm(60) } },
  { id: 'table-80', name: 'ترابيزة مربعة ٨٠', category: 'table', size: { w: cm(80), d: cm(80), h: cm(75) }, clearance: none },
  { id: 'table-120', name: 'ترابيزة فصل ١٢٠×٥٠', category: 'table', size: { w: cm(120), d: cm(50), h: cm(75) }, clearance: none },
  { id: 'cocktail-60', name: 'ترابيزة كوكتيل عالية ٦٠', category: 'round-table', size: { w: cm(60), d: cm(60), h: cm(110) }, clearance: none, footprint: 'round' },
  // Seats
  { id: 'chair', name: 'كرسي', category: 'chair', size: { w: cm(45), d: cm(45), h: cm(90) }, clearance: { ...none, back: cm(40) }, seats: 1 },
  { id: 'chiavari', name: 'كرسي شيافاري', category: 'chair', size: { w: cm(40), d: cm(45), h: cm(92) }, clearance: { ...none, back: cm(40) }, seats: 1 },
  { id: 'armchair', name: 'فوتيه', category: 'sofa', size: { w: cm(80), d: cm(80), h: cm(85) }, clearance: { ...none, front: cm(50) }, seats: 1 },
  { id: 'loveseat', name: 'كنبة فردين', category: 'sofa', size: { w: cm(150), d: cm(85), h: cm(85) }, clearance: { ...none, front: cm(60) }, seats: 2 },
  { id: 'sofa', name: 'كنبة ٣ أفراد', category: 'sofa', size: { w: cm(210), d: cm(90), h: cm(85) }, clearance: { ...none, front: cm(60) }, seats: 3 },
  // Stage and focal points
  { id: 'kosha', name: 'كوشة العروسة ٣×٢ م', category: 'stage', size: { w: m(3), d: m(2), h: cm(40) }, clearance: { ...none, front: m(1.5) }, seats: 2 },
  { id: 'stage', name: 'مسرح ٤×٢ م', category: 'stage', size: { w: m(4), d: m(2), h: cm(60) }, clearance: { ...none, front: m(1.5) } },
  { id: 'stage-6x3', name: 'مسرح ٦×٣ م', category: 'stage', size: { w: m(6), d: m(3), h: cm(60) }, clearance: { ...none, front: m(2) } },
  { id: 'dance-floor', name: 'حلبة رقص ٥×٥ م', category: 'dance-floor', size: { w: m(5), d: m(5), h: cm(2) }, clearance: none },
  { id: 'dj', name: 'ركن الدي جي', category: 'counter', size: { w: cm(180), d: cm(75), h: cm(100) }, clearance: { ...none, back: cm(80) } },
  { id: 'screen', name: 'شاشة عرض ٣ م', category: 'box', size: { w: m(3), d: cm(50), h: m(2.5) }, clearance: { ...none, front: m(2) } },
  { id: 'lectern', name: 'منبر كلمة', category: 'desk', size: { w: cm(60), d: cm(50), h: cm(115) }, clearance: { ...none, back: cm(80) } },
  { id: 'backdrop', name: 'خلفية تصوير ٣ م', category: 'box', size: { w: m(3), d: cm(30), h: m(2.5) }, clearance: { ...none, front: m(2) } },
  // Service
  { id: 'buffet', name: 'بوفيه ٢٤٠×٧٥', category: 'counter', size: { w: cm(240), d: cm(75), h: cm(90) }, clearance: { ...none, front: cm(120) } },
  { id: 'buffet-hot', name: 'بوفيه ساخن ٣٠٠×٩٠', category: 'counter', size: { w: cm(300), d: cm(90), h: cm(90) }, clearance: { ...none, front: cm(150), back: cm(80) } },
  { id: 'bar', name: 'بار مشروبات ٢٠٠×٦٠', category: 'counter', size: { w: cm(200), d: cm(60), h: cm(110) }, clearance: { ...none, front: cm(120), back: cm(80) } },
  { id: 'cake-table', name: 'ترابيزة التورتة', category: 'round-table', size: { w: cm(90), d: cm(90), h: cm(75) }, clearance: { front: cm(100), back: 0, left: 0, right: 0 }, footprint: 'round' },
  { id: 'reception', name: 'مكتب استقبال', category: 'desk', size: { w: cm(150), d: cm(60), h: cm(75) }, clearance: { ...none, front: cm(100), back: cm(80) } },
  { id: 'gift-table', name: 'ترابيزة الهدايا', category: 'table', size: { w: cm(120), d: cm(60), h: cm(75) }, clearance: { ...none, front: cm(80) } },
  { id: 'speaker', name: 'سماعة على حامل', category: 'box', size: { w: cm(50), d: cm(50), h: cm(180) }, clearance: none },
  { id: 'plant', name: 'زرع', category: 'plant', size: { w: cm(50), d: cm(50), h: cm(150) }, clearance: none, footprint: 'round' },
];

