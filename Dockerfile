FROM node:16

WORKDIR /usr/src/app

COPY package*.json yarn.lock ./
RUN yarn --pure-lockfile

COPY . .
EXPOSE 8080
CMD [ "yarn", "start:prod" ]
