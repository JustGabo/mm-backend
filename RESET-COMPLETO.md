# 🔄 Reset Completo del Repositorio

Ejecuta estos comandos EN ORDEN para empezar desde cero:

## Paso 1: Remover el repositorio Git actual
```bash
# Eliminar la carpeta .git completamente
Remove-Item -Recurse -Force .git
```

## Paso 2: Verificar que .env.local esté en .gitignore
Ya debería estar, pero verifica que `.gitignore` tenga:
```
.env
.env.local
.env.*.local
```

## Paso 3: Inicializar nuevo repositorio
```bash
git init
git branch -M main
```

## Paso 4: Agregar el remote
```bash
git remote add origin https://github.com/JustGabo/mm-backend.git
```

## Paso 5: Agregar todos los archivos (excepto los que están en .gitignore)
```bash
git add .
```

## Paso 6: Verificar que .env.local NO esté incluido
```bash
git status
```
Asegúrate de que `.env.local` NO aparezca en la lista.

## Paso 7: Hacer commit limpio
```bash
git commit -m "Initial commit - backend setup"
```

## Paso 8: Hacer push (forzar si es necesario)
```bash
git push -u origin main --force
```

¡Listo! Ahora debería funcionar sin problemas.


