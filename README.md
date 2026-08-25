# OmniChat AI — Complete Project Guide

<p align="center">
  <strong>AI-powered omnichannel customer support dashboard</strong><br />
  WhatsApp · Instagram · Messenger · Web Widget · Stripe payments · Gemini AI (free)
</p>

This README is a **complete, step-by-step guide** to the whole project — what every
piece does, how to set it up from zero, and how to run it locally.

---

## Table of Contents

1. [What This Project Is](#1-what-this-project-is)
2. [Tech Stack](#2-tech-stack)
3. [How the Pieces Fit Together (Architecture)](#3-how-the-pieces-fit-together-architecture)
4. [Project Structure (Every Folder)](#4-project-structure-every-folder)
5. [Prerequisites](#5-prerequisites)
6. [Get All Your API Keys & Accounts](#6-get-all-your-api-keys--accounts)
7. [Step 1 — Clone the Repository](#7-step-1--clone-the-repository)
8. [Step 2 — Create & Configure Supabase](#8-step-2--create--configure-supabase)
9. [Step 3 — Set Up the Database Schema](#9-step-3--set-up-the-database-schema)
10. [Step 4 — Configure Supabase Auth](#10-step-4--configure-supabase-auth)
11. [Step 5 — Configure the Frontend Environment (.env.local)](#11-step-5--configure-the-frontend-environment-envlocal)
12. [Step 6 — Install & Run the Frontend](#12-step-6--install--run-the-frontend)
13. [Step 7 — First Run, Sign-Up & Onboarding](#13-step-7--first-run-sign-up--onboarding)
14. [Step 8 — Configure the Backend (Express Server)](#14-step-8--configure-the-backend-express-server)
15. [Step 9 — Configure Gemini AI (Free)](#15-step-9--configure-gemini-ai-free)
16. [Step 10 — Configure WhatsApp (Meta) Webhooks](#16-step-10--configure-whatsapp-meta-webhooks)
17. [Step 11 — Configure Stripe Payments](#17-step-11--configure-stripe-payments)
18. [Step 12 — Optional: Test the Backend Widget & Dummy Channels](#18-step-12--optional-test-the-backend-widget--dummy-channels)
19. [The Dashboard Pages (What Each One Does)](#19-the-dashboard-pages-what-each-one-does)
20. [API Routes Reference](#20-api-routes-reference)
21. [Database Tables (Schema)](#21-database-tables-schema)
22. [Running Everything Together (Dev Workflow)](#22-running-everything-together-dev-workflow)
23. [Production Build & Deployment](#23-production-build--deployment)
24. [Testing with curl](#24-testing-with-curl)
25. [Troubleshooting](#25-troubleshooting)
26. [Next Steps / Roadmap](#26-next-steps--roadmap)

---