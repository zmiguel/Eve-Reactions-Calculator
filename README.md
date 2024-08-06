## Welcome

This is Eve Reactions Calculator

For EVE Refineries.

## Deployment

This project was re-created to run on Cloudflare Workers with D1 database and KV store.

To deploy this project on a production environment you need to create:

* 2 KV stores,
   1. `data`: for some static data
   2. `queries`: for the sql queries
* 1 D1 database
* 1 Pages Worker for the main webapp
* 1 Worker for the price updates

#### KV Stores

Check the `.wrangler/state/v3/kv` folder for the KV store data you need.

#### D1 Database

Import the file `d1_db_small.sql` to your database using wrangler-cli

#### Pages Worker

Create the worker in the cloudflare web interface and point it at your git repo

#### Price Worker

Deploy the code at `update/` to a regular worker. Make sure to setup a cron job to run it every 30 minutes to 1h
