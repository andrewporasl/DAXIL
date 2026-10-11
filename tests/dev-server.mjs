import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
const server = await createServer({ root: path.resolve('renderer'), plugins: [react()], resolve: { alias: { '@shared': path.resolve('shared'), '@': path.resolve('renderer/src') } }, server: { host: '127.0.0.1', port: 5178, strictPort: true } })
await server.listen()
console.log('DAXIL test development server ready')
