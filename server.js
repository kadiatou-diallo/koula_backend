import { config } from "dotenv";
config({ override: true });

// Maintenant importer l'app
import app from './src/app.js';

const PORT = 4000;

// Pour Vercel, ne pas utiliser app.listen() en production
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
  });
}

// Exporter l'app pour Vercel
export default app;

// Gestion des erreurs (garder seulement en local)
if (process.env.NODE_ENV !== 'production') {
  process.on('uncaughtException', (error) => {
    console.error('❌ Erreur:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise rejetée:', reason);
    process.exit(1);
  });
}