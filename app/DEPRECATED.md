# Legacy deprecado

El directorio `app/` (Express + EJS) **no forma parte del runtime de v2**.

- **Producción actual** (`whatsapp.mali.pe`) sigue en la rama `main` con este código.
- **Migración v2** (`migrate/v2`) es un despliegue **aislado**: NestJS + React + Prisma, sin compartir entorno ni cutover gradual.
- Usa `app/` solo como **referencia de lectura** al portar lógica de negocio a `api/src/`.

No añadir features nuevas aquí. No incluir `app` en Docker Compose de v2.
