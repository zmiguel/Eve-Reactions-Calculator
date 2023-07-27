FROM node:current
LABEL maintainer "Oxed G"

WORKDIR /opt/reactions
COPY / .

RUN apt update
RUN npm install -g pm2
RUN npm install
#RUN npm audit fix --force
RUN cd db_server/ && npm i && cd ..

RUN apt update
RUN apt install -y apt-utils screen
RUN wget -O /tmp/mongo-server.deb https://repo.mongodb.org/apt/ubuntu/dists/jammy/mongodb-org/6.0/multiverse/binary-arm64/mongodb-org-server_6.0.8_arm64.deb
RUN chmod +x /tmp/mongo-server.deb
RUN wget -O /tmp/mongo-tools.deb https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2204-arm64-100.7.4.deb
RUN chmod +x /tmp/mongo-tools.deb
RUN apt install /tmp/mongo-server.deb /tmp/mongo-tools.deb
RUN screen -dm mongod --bind_ip 127.0.0.1 --dbpath /var/lib/mongodb && \
    cd db_server/ && \
    sleep 10 && \
    mongoimport --db eve-reactor --collection bp-comp --file bp-comp.json --jsonArray && \
    mongoimport --db eve-reactor --collection bp-bio --file bp-bio.json --jsonArray && \
    mongoimport --db eve-reactor --collection bp-hybrid --file bp-hybrid.json --jsonArray && cd ..

EXPOSE 3000

CMD ["pm2-runtime", "process.yml"]
