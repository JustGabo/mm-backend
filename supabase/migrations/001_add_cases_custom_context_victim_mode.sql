-- Añadir columnas a la tabla cases para custom_context, custom_victim y mode
-- Ejecutar en el SQL Editor de Supabase (Dashboard → SQL Editor)

-- Columna para el contexto narrativo libre (customContext)
ALTER TABLE cases
ADD COLUMN IF NOT EXISTS custom_context text;

-- Columna para la víctima personalizada (customVictim) como JSON
ALTER TABLE cases
ADD COLUMN IF NOT EXISTS custom_victim jsonb;

-- Columna para el modo del caso: detective | impostor | multiplayer
-- detective = caso inicial (generate-initial-case)
-- impostor = caso impostor (generate-impostor-case)
-- multiplayer = fases multijugador (generate-impostor-phases)
ALTER TABLE cases
ADD COLUMN IF NOT EXISTS mode text;

-- Opcional: valor por defecto para filas existentes y constraint
-- UPDATE cases SET mode = 'detective' WHERE mode IS NULL;
-- ALTER TABLE cases ADD CONSTRAINT cases_mode_check CHECK (mode IN ('detective', 'impostor', 'multiplayer'));

COMMENT ON COLUMN cases.custom_context IS 'Contexto narrativo libre provisto por el usuario (customContext)';
COMMENT ON COLUMN cases.custom_victim IS 'Víctima personalizada: name, gender, age, role, description, notableTrait (customVictim)';
COMMENT ON COLUMN cases.mode IS 'Modo del caso: detective | impostor | multiplayer';
