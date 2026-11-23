// src/components/supabase.js - Re-export de conveniencia para máxima compatibilidad de imports
export * from '../lib/supabase.js';
import { supabase, SUPABASE_URL } from '../lib/supabase.js';
export { supabase, SUPABASE_URL };
export default supabase;
