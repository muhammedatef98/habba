// Route file. The screen lives in @/features/provider/screens/quote.
//
// Distinct from (customer)/quote.tsx, which is the APPROVAL side of the same
// lines. The two never import each other (§5.1.5) — they share `order_parts`
// and nothing else.
export { default } from '@/features/provider/screens/quote';
