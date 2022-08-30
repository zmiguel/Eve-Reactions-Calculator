FROM node:current
LABEL maintainer "Oxed G"

WORKDIR /opt/reactions
COPY / .

RUN apt update
RUN npm install -g pm2
RUN npm install
#RUN npm audit fix --force
RUN cd db_server/ && npm i && cd ..

RUN apt install gnupg
RUN wget -qO - https://www.mongodb.org/static/pgp/server-4.4.asc | apt-key add -
RUN echo "deb http://repo.mongodb.org/apt/debian buster/mongodb-org/4.4 main" | tee /etc/apt/sources.list.d/mongodb-org-4.4.list
RUN apt update
RUN apt install -y apt-utils mongodb-org screen
RUN screen -dm mongod --bind_ip 127.0.0.1 --dbpath /var/lib/mongodb && \
    cd db_server/ && \
    sleep 15 && mongoimport --db eve-reactor --collection bp-comp --file bp-comp.json --jsonArray && \
    sleep 5 && mongoimport --db eve-reactor --collection bp-hybrid --file bp-hybrid.json --jsonArray && \
    sleep 5 && mongoimport --db eve-reactor --collection bp-bio --file bp-bio.json --jsonArray && sleep 5 && cd ..

EXPOSE 3000

CMD ["pm2-runtime", "process.yml"]
