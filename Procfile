Still failing with the same Railpack error. The Procfile didn't fix it.
The most reliable fix is to tell Railway to use a specific Node.js version. Add this to your package.json on GitHub — edit the file and replace the contents with:
json{
  "name": "swap-server",
  "version": "1.0.0",
  "description": "Swap Path Finder shared database server",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "engines": {
    "node": "18.x"
  },
  "dependencies": {
    "express": "^4.18.2",
    "better-sqlite3": "^9.4.3"
  }
}
