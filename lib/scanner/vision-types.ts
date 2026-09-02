/** Shape returned by the vision model. Mirrors CardReadSchema in lib/vision.ts,
 *  kept separate so client code can type it without importing server-only code. */
export interface CardRead {
  is_pokemon_card: boolean;
  name: string | null;
  alternate_names: string[];
  number: string | null;
  number_confidence: number;
  set_name: string | null;
  set_confidence: number;
  rarity: string | null;
  hp: string | null;
  legibility: 'clear' | 'partial' | 'poor';
  confidence: number;
  notes: string;
}
