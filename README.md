# Simple Ledger ERP — Deposit (`+`) & Withdrawal (`-`) System

A complete **Admin & User Deposit/Withdrawal Ledger ERP** with Admin Approval workflow and PDF Statement exports:

- **Admin Role (`ADMIN`):**
  - **Direct User Creation (Sirf Name & Password):** Creates users by entering **only Name and Password** — no extra fields needed.
  - **Admin-Controlled Select Options:** Adds/removes dropdown options on the Dashboard (e.g. `Cash Deposit`, `UPI / Bank Deposit`, `Cash Withdrawal`, `UPI / Bank Withdrawal`, `Site Material`, `Petrol / Transport`, etc.) that users must choose from when submitting a Deposit or Withdrawal.
  - **Approve / Reject Queue:** Reviews user-submitted **Deposit (`+`)** and **Withdrawal (`-`)** requests (`✓ Approve` or `✕ Reject` with reason), with a live pending count badge in the sidebar.
  - **Direct Deposit / Withdrawal & 1-Click Password Reset (`Pass`):** Can record a Deposit (`+`) or Withdrawal (`-`) for any user and change any user's password in 1 click.
  - **PDF Downloads (User Ledger PDF + All Users Summary PDF):** Downloads any user's ledger in `.pdf` format (with 1-click **All Time**, **This Month**, and **Last Month** filters) or downloads the **All Users Summary PDF** from the bottom of the Dashboard / Users page.
- **Normal User Role (`USER`):**
  - Logs in using the **Name** and **Password** given by the Admin.
  - **Password Locked to Admin:** Users cannot change their own password; only the password set by the Admin remains active.
  - **Private User Portal:** Users only see their own Deposit (`+`), Withdrawal (`-`), Net Balance, and their own submitted entries (never other users' ledgers).
  - **Submit Deposit (`+`) or Withdrawal (`-`):** Selects an option from the Admin's dropdown list, adds an optional **Detail / Remark** (e.g. `"2 bag cement"`, `"ATM"`, `"GPay"`), and submits the amount for Admin approval.

- **Frontend:** React 19, Vite, TypeScript, Tailwind CSS (`frontend/`)
- **Backend:** Node.js, Express 5, TypeScript (`backend/`)
- **Database:** MySQL (Local MySQL / XAMPP / Aiven / TiDB Cloud / Railway), accessed through Prisma ORM
- **Docs:** [API reference](docs/API.md)

---

## 💻 Part 1: Local VS Code Setup (3 Easy Steps)

### Prerequisites

| Tool | Required Version | Download Link |
|---|---|---|
| **Node.js (LTS)** | **v20.19+** (v22 LTS recommended) | https://nodejs.org |
| **MySQL Server** *(ya XAMPP)* | **MySQL 8.0+** (5.7 / MariaDB / XAMPP bhi chalega) | https://dev.mysql.com/downloads/installer/ |

> 💡 **VS Code PowerShell Error Fix (Windows):**
> Agar VS Code terminal me `npm` chalane par **`npm.ps1 cannot be loaded because running scripts is disabled on this system`** error aaye, toh VS Code terminal me ye command ek baar run karein:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
> ```

---

### Step 1: Packages Install karein (`npm run setup`)

VS Code me `erp-system` folder open karein, Terminal kholein (`Ctrl + ~`), aur run karein:

```bash
npm run setup
```
- Ye command `backend` aur `frontend` dono ke packages install karegi aur `backend/.env` file bana degi.

---

### Step 2: MySQL Password set karein aur Database Setup run karein (`npm run db:setup:demo`)

1. **`backend/.env`** file kholein aur `DATABASE_URL` me apna MySQL password daalein:
   - **MySQL Server (root password `12345` example):**
     ```env
     DATABASE_URL="mysql://root:12345@localhost:3306/erp_ledger"
     ```
   - **XAMPP MySQL (no password):**
     ```env
     DATABASE_URL="mysql://root:@localhost:3306/erp_ledger"
     ```
2. Terminal me run karein:
   ```bash
   npm run db:setup:demo
   ```
   *(Bina demo users ke setup karne ke liye sirf `npm run db:setup` chalayein).*

**Default Login Credentials:**
- **Admin Login:** Username `admin` | Password `Admin@12345`
- **Demo User 1:** Name `Rahul` (ya `rahul`) | Password `rahul123`
- **Demo User 2:** Name `Amit` (ya `amit`) | Password `amit123`

---

### Step 3: Project Start karein (`npm run dev`)

```bash
npm run dev
```
- Browser me kholein: **[http://localhost:5173](http://localhost:5173)** (Backend port `4000` par aur Frontend port `5173` par ek saath start ho jayega).

---

## 🌐 Part 2: Complete Step-by-Step Deployment Guide (Database + Backend + Frontend)

Niche **Database (`MySQL`) -> Backend (`Render / Railway`) -> Frontend (`Vercel / Netlify`)** deploy karne ka poora step-by-step guide diya gaya hai.

```text
┌──────────────────────────┐        HTTPS (/api/*)        ┌──────────────────────────┐       MySQL SSL (3306)       ┌──────────────────────────┐
│   FRONTEND (Vercel)      │  ─────────────────────────►  │   BACKEND (Render)       │  ─────────────────────────►  │   DATABASE (Aiven/TiDB)  │
│   React + Vite (dist/)   │                              │   Node.js + Express API  │                              │   Cloud MySQL Server     │
└──────────────────────────┘                              └──────────────────────────┘                              └──────────────────────────┘
```

---

### 🗄️ STEP 1: Database (`MySQL`) Deploy Karein (Aiven / TiDB Cloud / Railway)

Sabse pehle Cloud par ek MySQL Database banayein ताकि Backend usse connect ho sake:

#### Option 1A: Aiven Free MySQL (Recommended Free Forever Plan)
1. **[https://aiven.io](https://aiven.io)** par free account banayein aur login karein.
2. **Create Service** par click karein -> **MySQL** select karein.
3. Cloud provider & region चुनें (jaise DigitalOcean / AWS India ya Singapore) aur **Free Plan ($0/month)** select karein.
4. Service ka naam `erp-mysql` rakhein aur **Create Free Service** par click karein.
5. 2–3 minute me status **Running** ho jayega. Ab **Connection Information** me se **Service URI** copy karein. Wo kuch aisa dikhega:
   ```text
   mysql://avnadmin:AVNS_xxxxxxxxxxxx@mysql-erp-xxxx.aivencloud.com:12345/defaultdb?ssl-mode=REQUIRED
   ```
6. **Important:** Is URI ke end me se `?ssl-mode=REQUIRED` hata dein (kyunki hum Backend me `DB_SSL=true` lagayenge). Aapka final `DATABASE_URL` aisa hona chahiye:
   ```text
   mysql://avnadmin:AVNS_xxxxxxxxxxxx@mysql-erp-xxxx.aivencloud.com:12345/defaultdb
   ```

#### Option 1B: Railway MySQL (Agar aap Railway use kar rahe hain)
1. **[https://railway.app](https://railway.app)** par **New Project** -> **Provision MySQL** par click karein.
2. MySQL service par click karein -> **Variables** tab me jaakar **`MYSQL_URL`** copy कर lein (wahi aapka `DATABASE_URL` hai).

> ✅ **Database Tables Kaise Banenge?**
> Aapko Cloud MySQL me manually koi SQL query nahi chalani hai! Jab Step 2 me Backend start hoga, uska Start Command (`npm run db:setup && npm start`) **automatically** saare tables, triggers aur Admin account (`admin`) bana dega.

---

### ⚙️ STEP 2: Backend (`Node.js + Express`) Deploy Karein (Render.com ya Railway.app)

1. Sabse pehle apna project code apne **GitHub repository** par push karein.
2. **[https://render.com](https://render.com)** par login karein -> top right me **New +** -> **Web Service** par click karein.
3. Apna GitHub repository (`erp-system`) connect karein.
4. Render form me ye **exact settings** bharein:

| Setting | Kya Daalna Hai |
|---|---|
| **Name** | `erp-ledger-backend` |
| **Root Directory** | `backend` *(Zaroor daalein!)* |
| **Runtime** | `Node` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm run db:setup && npm start` |
| **Instance Type** | `Free` (ya Paid) |

5. Ab neeche **Environment Variables** section me **Add Environment Variable** par click karke ye saare variables add karein:

| Key | Value | Kyun Zaroori Hai |
|---|---|---|
| `NODE_ENV` | `production` | Production security & optimizations on karta hai |
| `PORT` | `4000` | Backend server port |
| `DATABASE_URL` | `mysql://avnadmin:...@.../defaultdb` | Step 1 me copy kiya hua MySQL URL |
| `DB_SSL` | `true` | Cloud MySQL (Aiven / TiDB) ke SSL connection ke liye (`Railway` local network ho toh `false`) |
| `APP_TIMEZONE` | `Asia/Kolkata` | Indian Standard Time (`IST`) date calculation ke liye |
| `COOKIE_SECURE` | `true` | HTTPS par login cookie secure rakhne ke liye |
| `TRUST_PROXY` | `1` | Render/Railway ke load balancer ke peeche HTTPS detect karne ke liye |
| `CORS_ORIGIN` | `https://your-frontend.vercel.app` | Aapke Frontend ka URL *(Step 3 ke baad exact Vercel URL yahan update karein)* |
| `ADMIN_USERNAME` | `admin` | Default Admin Login ID |
| `ADMIN_PASSWORD` | `Admin@12345` *(ya koi strong 10+ char password)* | Default Admin Password |

6. **Deploy Web Service** par click karein.
7. Build aur deploy poora hone ke baad Render aapko ek URL dega, jaise:
   ```text
   https://erp-ledger-backend.onrender.com
   ```
8. **Verify Backend:** Apne browser me ye URL khol kar check karein:
   ```text
   https://erp-ledger-backend.onrender.com/api/health
   ```
   Agar `{"status":"ok", ...}` dikh raha hai, toh aapka **Database + Backend 100% live** ho chuka hai! 🎉

---

### 🖥️ STEP 3: Frontend (`React + Vite`) Deploy Karein (Vercel ya Netlify)

Ab Frontend ko **Vercel** par deploy karein aur Backend se jodein:

#### Method 3A: Vercel Deployment with `vercel.json` Proxy (Recommended — Mobile & Safari Friendly!)

Is method me Vercel khud `/api/*` requests ko aapke Render Backend par forward karta hai, jisse iPhone/Android browsers me third-party cookie ya CORS ki koi problem nahi aati:

1. Project ke andar **`frontend/vercel.json`** file kholein aur usme `https://your-backend-service.onrender.com` ki jagah apna Step 2 wala asli Render Backend URL daal dein:
   ```json
   {
     "rewrites": [
       {
         "source": "/api/:path*",
         "destination": "https://erp-ledger-backend.onrender.com/api/:path*"
       },
       {
         "source": "/(.*)",
         "destination": "/index.html"
       }
     ]
   }
   ```
   *(Agar aap `VITE_API_URL` environment variable use karna chahte hain, toh niche Step 4 dekhein).*
2. **[https://vercel.com](https://vercel.com)** par login karein -> **Add New...** -> **Project** par click karein.
3. Apna GitHub repository (`erp-system`) **Import** karein.
4. Vercel Configure Project screen par ye **exact settings** rakhein:

| Setting | Kya Daalna Hai |
|---|---|
| **Framework Preset** | `Vite` |
| **Root Directory** | `frontend` *(Edit button dabayein aur `frontend` folder select karein!)* |
| **Build Command** | `npm run build` |
| **Output Directory** | `dist` |

5. **Environment Variables** (Vercel me):
   - Agar aapne upar `frontend/vercel.json` me apna Backend URL daal diya hai, toh `VITE_API_URL` daalne ki bhi zaroorat nahi hai (use blank chhod sakte hain).
   - Ya fir aap **Environment Variables** me ye add kar sakte hain:
     - **Key:** `VITE_API_URL`
     - **Value:** `https://erp-ledger-backend.onrender.com` *(Bina trailing `/` ke)*
6. **Deploy** button par click karein!
7. 1 minute me Vercel aapko live Frontend URL de dega, jaise:
   ```text
   https://erp-system-xyz.vercel.app
   ```
8. **Final Link Step:** Is Vercel URL (`https://erp-system-xyz.vercel.app`) ko copy karein aur **Render Backend -> Environment -> `CORS_ORIGIN`** me paste karke **Save Changes** kar dein.

🎉 **Congratulations!** Ab aap apna Vercel URL khol kar `admin` / `Admin@12345` se login kar sakte hain, Users create kar sakte hain, aur PDF download kar sakte hain!

---

### 🚀 Alternative: Ek Hi Server Par Frontend + Backend Deploy Karein (Render / Railway Single Service)

Agar aap Vercel aur Render alag-alag nahi rakhna chahte, toh **sirf Render (ya Railway)** par ek hi Web Service me Frontend aur Backend dono chala sakte hain (Backend automatically built Frontend `frontend/dist` ko serve karta hai):

1. Render / Railway par **New Web Service** banayein aur GitHub repo connect karein.
2. Settings me ye rakhein:
   - **Root Directory:** *(Blank chhod dein — root `/` hi rahega)*
   - **Build Command:** `npm run setup && npm run build`
   - **Start Command:** `npm run db:setup && npm start`
3. **Environment Variables:**
   - `NODE_ENV` = `production`
   - `PORT` = `4000`
   - `DATABASE_URL` = `mysql://...` *(Aapka Cloud MySQL URL)*
   - `DB_SSL` = `true`
   - `COOKIE_SECURE` = `true`
   - `TRUST_PROXY` = `1`
   - `ADMIN_USERNAME` = `admin`
   - `ADMIN_PASSWORD` = `Admin@12345`
4. Deploy hone ke baad ek hi URL par aapka Frontend aur Backend dono live chalenge!

---

### 🖥️ Option C: Ubuntu Cloud VPS Deployment (DigitalOcean / Hostinger VPS / AWS EC2)

Agar aapke paas apna Ubuntu 22.04 / 24.04 VPS server hai, toh wahan MySQL + Backend + Frontend + Nginx HTTPS ek hi server par chalane ke steps:

#### 1. Node.js 22, MySQL Server aur Nginx Install karein
```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs mysql-server nginx certbot python3-certbot-nginx ufw
```

#### 2. MySQL me Database (`erp_ledger`) aur User banayein
```bash
sudo mysql -e "
CREATE DATABASE IF NOT EXISTS erp_ledger CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'erp_user'@'localhost' IDENTIFIED BY 'StrongDbPassword123!';
GRANT ALL PRIVILEGES ON erp_ledger.* TO 'erp_user'@'localhost';
FLUSH PRIVILEGES;
"
```

#### 3. Project Clone karein aur `.env` Configure karein
```bash
sudo mkdir -p /var/www/erp-system
sudo chown -R $USER:$USER /var/www/erp-system
git clone https://github.com/ajayvaidyaOP/erp-system.git /var/www/erp-system
cd /var/www/erp-system
npm run setup
```

`backend/.env` edit karein (`nano /var/www/erp-system/backend/.env`):
```env
NODE_ENV=production
PORT=4000
HOST=127.0.0.1
DATABASE_URL="mysql://erp_user:StrongDbPassword123!@127.0.0.1:3306/erp_ledger"
APP_TIMEZONE="Asia/Kolkata"
COOKIE_SECURE=true
TRUST_PROXY=1
ADMIN_USERNAME="admin"
ADMIN_PASSWORD="StrongAdminPassword123!"
```

#### 4. Database Setup aur Production Build chalayein
```bash
npm run db:setup
npm run build
```

#### 5. PM2 se Server 24x7 Background me Start karein
```bash
sudo npm install -g pm2
pm2 start backend/dist/server.js --name erp-ledger --cwd /var/www/erp-system/backend
pm2 save
pm2 startup
```

#### 6. Nginx + Free HTTPS SSL (`Let's Encrypt`) lagayein
`/etc/nginx/sites-available/erp-ledger` file banayein:
```nginx
server {
    listen 80;
    server_name ledger.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Enable Nginx & SSL:
```bash
sudo ln -s /etc/nginx/sites-available/erp-ledger /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d ledger.yourdomain.com
```

---

## 🛠️ Part 3: Common Problems & Instant Fixes (Troubleshooting)

| Problem / Error | Kyu aata hai & Kaise theek karein (Fix) |
|---|---|
| **`Access denied for user 'root'@'localhost'`** | `backend/.env` kholein aur `DATABASE_URL` me apna sahi MySQL password daalein. Agar XAMPP hai toh `mysql://root:@localhost:3306/erp_ledger` rakhein. |
| **`ECONNREFUSED 127.0.0.1:3306`** | MySQL Server band hai. Windows Services (`services.msc`) me `MySQL80` start karein, ya XAMPP Control Panel me MySQL **Start** karein. |
| **Cloud MySQL par `SELF_SIGNED_CERT_IN_CHAIN` ya SSL error** | Backend ke Environment Variables me `DB_SSL=true` set karein aur `DATABASE_URL` ke aakhir se `?ssl-mode=REQUIRED` hata dein. |
| **Deploy ke baad Login karne par `403 Cross-site request blocked`** | Render Backend ke environment variables me `CORS_ORIGIN=https://your-frontend.vercel.app` (bina trailing `/` ke) aur `COOKIE_SECURE=true` set karein. |
| **Error 1419 (`You do not have the SUPER privilege and binary logging is enabled`)** | `npx prisma migrate deploy` ki jagah **`npm run db:setup`** use karein — ye script triggers aur binary logging ko automatically handle kar leti hai. |

---

## 📋 Part 4: All Available Commands (Root Folder `erp-system/`)

| Command | Kya karta hai |
|---|---|
| `npm run setup` | Backend + Frontend ke packages install karta hai aur `backend/.env` banata hai |
| `npm run db:setup` | MySQL database, tables, triggers aur default Admin (`admin` / `Admin@12345`) banata hai |
| `npm run db:setup:demo` | Database setup ke saath demo users (`rahul` / `rahul123` aur `amit` / `amit123`) bhi add karta hai |
| `npm run dev` | Backend (port 4000) aur Frontend (port 5173) dono ek saath start karta hai |
| `npm run build` | Frontend (`frontend/dist`) aur Backend (`backend/dist`) dono ko production ke liye build karta hai |
| `npm start` | Built app ko production mode me `http://localhost:4000` par chalata hai |
| `npm test` | Backend ke unit tests run karta hai |
