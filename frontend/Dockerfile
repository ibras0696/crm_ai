FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 5173

ARG API_URL=http://api:8000
ENV API_URL=${API_URL}

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
