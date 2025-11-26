# 🔧 Cómo resolver el error de GitHub Push Protection

## El Problema

GitHub detectó que intentaste subir un archivo `.env.local` que contiene una API key de OpenAI. GitHub automáticamente bloquea esto para proteger tus secretos.

## Solución Rápida

### Paso 1: Remover el archivo del commit actual

```bash
# Remover .env.local del staging
git reset HEAD .env.local

# Si ya hiciste commit, necesitas removerlo del último commit
git reset --soft HEAD~1
```

### Paso 2: Asegurar que esté en .gitignore

Verifica que `.gitignore` tenga:
```
.env
.env.local
.env.*.local
```

### Paso 3: Remover el archivo del historial de Git

```bash
# Remover el archivo del índice de Git
git rm --cached .env.local

# Hacer commit de la remoción
git commit -m "Remove .env.local from git tracking"
```

### Paso 4: Hacer push de nuevo

```bash
git push -u origin main
```

## Si el archivo ya está en el historial

Si el archivo ya está en commits anteriores, necesitas limpiar el historial:

```bash
# Usar git filter-branch o BFG Repo-Cleaner
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch .env.local" \
  --prune-empty --tag-name-filter cat -- --all

# O mejor, usar git filter-repo (más moderno)
# Necesitas instalarlo primero: pip install git-filter-repo
git filter-repo --path .env.local --invert-paths
```

## Importante

⚠️ **Si ya expusiste la API key:**
1. Ve a OpenAI y revoca la API key expuesta
2. Genera una nueva API key
3. Actualiza tu `.env.local` con la nueva key

## Prevención

Para evitar esto en el futuro:
- ✅ NUNCA agregues archivos `.env*` a git
- ✅ Usa `.env.example` con valores placeholder
- ✅ Revisa `git status` antes de hacer commit
- ✅ Usa `git diff` para ver qué estás agregando

