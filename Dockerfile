FROM node:22

WORKDIR /usr/src/app

COPY package*.json yarn.lock ./
RUN yarn --pure-lockfile

COPY . .
RUN yarn build

EXPOSE 8080
CMD [ "yarn", "start:prod" ]
