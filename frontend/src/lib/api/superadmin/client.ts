import axios from 'axios'

export const superadminHttp = axios.create({
  baseURL: '/api/v1/superadmin',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})
