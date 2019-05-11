FROM ubuntu
RUN apt -y upgrade
RUN apt -y update
RUN apt -y install curl
RUN curl -sL https://deb.nodesource.com/setup_10.x | bash
RUN apt -y install nodejs make python build-essential dos2unix git

WORKDIR /data
VOLUME /data

WORKDIR /root/xterminus
COPY *.json ./
RUN npm install
COPY .bashrc ./
COPY *.js ./
COPY *.html ./
COPY .site .site
RUN cat .bashrc >> ../.bashrc
RUN dos2unix ../.bashrc
ENTRYPOINT node /root/xterminus/server
