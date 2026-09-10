import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The channel the browser subscribes to, checked against the config that ships.
 *
 * use-notifications subscribes to `notifications#<userId>` and notification-service
 * publishes there. Centrifugo picks a namespace from the `:` separator, and that
 * name has none, so it takes the `without_namespace` options, where client
 * subscription was off. Every subscription was refused with code 103 in dev and,
 * with the identical prod file, in production: realtime notifications never
 * reached anyone and the bell moved only on its two-minute poll.
 *
 * `#` limits a channel to one user only when `allow_user_limited_channels` is on,
 * so that flag is what makes the channel reachable by its user and refused to
 * everyone else. The `notifications` namespace the name looks like it belongs to
 * is not used by the publisher and let any client subscribe to any id, so it is
 * closed rather than left as a second, unguarded door.
 */

type Options = { allow_subscribe_for_client?: boolean; allow_user_limited_channels?: boolean }
type Config = {
  channel: { without_namespace: Options; namespaces: Array<Options & { name: string }> }
}

const GATEWAY = path.resolve(__dirname, '../../../gateway')
const SUBSCRIBER = readFileSync(path.resolve(__dirname, '../hooks/use-notifications.ts'), 'utf8')

it('subscribes to a user-limited channel that carries no namespace', () => {
  expect(SUBSCRIBER).toMatch(/`notifications#\$\{userId\}`/)
})

describe.each(['centrifugo.json', 'centrifugo-prod.json'])('%s', (file) => {
  const config = JSON.parse(readFileSync(path.join(GATEWAY, file), 'utf8')) as Config

  it('lets a user subscribe to their own user-limited channel', () => {
    expect(config.channel.without_namespace.allow_user_limited_channels).toBe(true)
  })

  it('does not open the unused notifications namespace to every client', () => {
    const ns = config.channel.namespaces.find((n) => n.name === 'notifications')
    expect(ns?.allow_subscribe_for_client).not.toBe(true)
  })
})
