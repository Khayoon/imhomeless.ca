# Homelessness Support App

The uncertainty and hardship that comes with being homeless is something no one should ever have to experience. This site aims to help those in need by providing essential information, resources, and a way to center themselves during these challenging times. By giving them access to local resources, this full stack app should alleviate some of the stress and confusion faced by people in this situation and gain a sense of control.

## Overview

This is designed to provide useful information for homeless individuals and connect them with local resources such as shelters, food banks, medical services, and more. Additionally, the app includes features to help users gather their thoughts, set goals, and work towards improving their situation.

## Features

- Local resource directory: Find nearby shelters, food banks, and other essential services.
- Personal journal: Record thoughts, feelings, and experiences in a secure and private space.
- Goal setting: Set short and long-term goals to work towards self-improvement and stability.
- Mental health support: Access to crisis hotlines, support groups, and mental health resources.
- Customizable notifications: Receive reminders about important appointments, events, or deadlines.
- Offline functionality: Access important resources and journal entries even without internet access.

# Project Goal

Homelessness is a challenging and uncertain experience that no one should have to face. This app aims to help those in need by providing essential information, resources, and a way to center themselves during these difficult times. By connecting people to local resources, im looking to alleviate some of the stress and confusion faced by those experiencing homelessness.

---

## The app

The features above are now implemented in `index.html` — a single, self-contained,
offline-first web app (plain HTML/CSS/vanilla JS, no build step, no backend).

- **Crisis & support lines** — one-tap 911, 9-8-8 Suicide Crisis Helpline, 211,
  Kids Help Phone, Hope for Wellness, Health811. Always reachable from the header.
- **Resource directory** — shelter, food, health, income & ID, legal, and youth
  services, filterable by category, pointing to real national services and
  official locators (2-1-1 as the local connector).
- **Private journal, goals, and reminders** — saved on-device via `localStorage`
  (in-memory fallback). No account, nothing sent to a server.
- **Works offline**, mobile-first, accessible, light/dark themes.

### Run it
Open `index.html` in any browser, or host it as a static site (GitHub Pages works).

### Note on resources
Phone numbers verified September 2026. Because local services change, the app
leans on **2-1-1** — Canada's free, 24/7, multilingual line — as the primary way
to reach current, location-specific help, rather than hard-coding addresses that
go stale.

### Disclaimer
Independent tool, not affiliated with any government agency. It surfaces public
resources and official locators; it does not provide the services itself.

