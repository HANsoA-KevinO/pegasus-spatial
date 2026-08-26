import mongoose from 'mongoose'
import { createUser, getUserByEmail, verifyPassword } from '../lib/db/user-repository'
import {
  assertSafeDemoEnvironment,
  ensureDemoMongo,
} from './demo-local'

function parseEmail(argv: string[]): string {
  let email = ''
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--email') {
      email = argv[index + 1] ?? ''
      index += 1
      continue
    }
    if (value.startsWith('--email=')) {
      email = value.slice('--email='.length)
      continue
    }
    throw new Error(`未知参数：${value}`)
  }
  const normalized = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('请使用 --email <邮箱> 提供有效的演示登录邮箱。')
  }
  return normalized
}

function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new Error('账号初始化需要交互式终端，以便隐藏密码输入。')
  }
  return new Promise((resolve, reject) => {
    let value = ''
    const finish = (error?: Error) => {
      process.stdin.off('data', onData)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdout.write('\n')
      if (error) reject(error)
      else resolve(value)
    }
    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString()
      for (const character of text) {
        if (character === '\u0003') return finish(new Error('账号初始化已取消。'))
        if (character === '\r' || character === '\n') return finish()
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1)
          continue
        }
        if (character >= ' ') value += character
      }
    }
    process.stdout.write(prompt)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', onData)
  })
}

async function main(): Promise<void> {
  const email = parseEmail(process.argv.slice(2))
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new Error('账号初始化需要交互式终端，以便隐藏密码输入。')
  }
  assertSafeDemoEnvironment()
  await ensureDemoMongo()

  try {
    const existing = await getUserByEmail(email)
    const password = await readHidden('演示账号密码（输入不会显示）：')
    if (password.length < 12) throw new Error('演示账号密码至少需要 12 个字符。')

    if (existing) {
      if (!await verifyPassword(existing, password)) {
        throw new Error('该邮箱已存在，但密码验证失败；未修改任何账号。')
      }
      console.log('演示账号已存在且凭证验证通过；未重复创建。')
      return
    }

    const confirmation = await readHidden('再次输入密码：')
    if (confirmation !== password) throw new Error('两次密码输入不一致；未创建账号。')
    await createUser({
      email,
      name: 'Pegasus Spatial Demo',
      password,
    })
    console.log('演示账号创建完成。密码未写入日志；请由现场负责人安全保管。')
  } finally {
    await mongoose.disconnect()
  }
}

main().catch(error => {
  console.error(`[demo:bootstrap] ${(error as Error).message}`)
  process.exitCode = 1
})
