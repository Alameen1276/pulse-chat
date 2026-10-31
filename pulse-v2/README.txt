PULSE v3 - chat with accounts and saved messages
================================================

WHAT'S NEW
  - Sign up / Log in with a name and password (same name = same account)
  - Accounts and messages are saved in MongoDB Atlas, so they survive
    logouts, Render sleeping, and redeploys

RUN IT LOCALLY (Windows PowerShell)
  1. Open the folder that contains package.json and server.js
  2. npm install
  3. npm start     (without a database, data is kept in memory only)

TO SAVE DATA PERMANENTLY
  Set an environment variable called MONGODB_URI to your Atlas connection string
  (starts with mongodb+srv://). On Render: Environment -> Add Environment Variable.
