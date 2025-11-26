# 🔧 Pasos para Remover el Secreto del Historial de Git

## Paso 1: Ver el historial de commits
```bash
git log --oneline
```

## Paso 2: Remover .env.local del commit actual
```bash
# Remover el archivo del índice de Git
git rm --cached .env.local

# Ver el estado
git status
```

## Paso 3: Modificar el commit que tiene el secreto

Tenemos dos opciones:

### Opción A: Si el commit es el último (más común)
```bash
# Remover el último commit pero mantener los cambios
git reset --soft HEAD~1

# Remover .env.local del staging
git reset HEAD .env.local

# Hacer commit de nuevo SIN .env.local
git add .
git commit -m "Initial commit - backend setup"

# Push
git push -u origin main
```

### Opción B: Si necesitas limpiar todo el historial
```bash
# Limpiar completamente el historial local
rm -rf .git
git init
git add .
git commit -m "Initial commit - backend setup"
git branch -M main
git remote add origin https://github.com/JustGabo/mm-backend.git
git push -u origin main --force
```

## ⚠️ IMPORTANTE: Si ya pusheaste antes
Si ya intentaste pushear antes y GitHub rechazó, el commit aún está solo en tu repositorio local, así que podemos hacer reset sin problemas.

