import { test, expect, type Page } from '@playwright/test'
import { expectedPatterns, getQuestionsFromCategory } from './data/questionBank'
import {
  assistantReplyCount,
  ollamaBackendProblem,
  passConnectionGate,
  waitForReply
} from './support/connectionGate'

/**
 * The agent suite talks to a real model. The build under test uses the Ollama provider (the
 * webServer env in playwright.config.ts), and the app answers nothing but "I am not connected
 * yet" until Check connection has passed, so every conversation test first passes that gate the
 * way a person does (tests/support/connectionGate.ts).
 *
 * Without the Ollama server and model, the conversation tests are skipped with the reason. Set
 * E2E_REQUIRE_BACKEND=1 to fail them instead, for a run that must exercise a backend.
 */

async function waitForAgentReady(page: Page) {
  await page.waitForSelector('.app-container, div[class*="min-h-screen"]', { timeout: 30000 })
  await page.waitForSelector('canvas', { timeout: 30000 })
  // Give the agent a bit more time to initialize
  await page.waitForTimeout(2000)
}

async function sendMessage(page: Page, message: string) {
  const chatInput = page.getByPlaceholder(/type your message/i)
  await chatInput.fill(message)
  await chatInput.press('Enter')
}

/** Send one message and return the reply to it. */
async function ask(page: Page, message: string, timeout?: number): Promise<string> {
  const before = await assistantReplyCount(page)
  await sendMessage(page, message)
  const reply = await waitForReply(page, before, timeout)
  expect(reply, 'the gate let this turn through').not.toContain('I am not connected yet')
  return reply
}

/**
 * The model phrases replies its own way: on 2026-11-25 gemma3:1b answered "Hello" with "Good to hear
 * you're here!". A reply that misses a category's wording is noted on the report rather than failed,
 * because what these specs test is that the app gets a reply through, not the model's style.
 */
function noteIfUnlike(response: string, pattern: RegExp | undefined, category: string) {
  if (pattern && !pattern.test(response)) {
    test.info().annotations.push({
      type: 'model',
      description: `the ${category} reply did not match ${pattern}: "${response.slice(0, 120)}"`
    })
  }
}

/**
 * Helper to check if avatar is animating
 */
async function checkAvatarAnimation(page: Page): Promise<boolean> {
  const canvas = page.locator('canvas').first()
  if (!(await canvas.isVisible())) {
    return false
  }
  // Take two screenshots of the canvas at different times
  const screenshot1 = await canvas.screenshot()
  await page.waitForTimeout(500)
  const screenshot2 = await canvas.screenshot()
  // Compare - if they're different, the avatar is animating
  return Buffer.compare(screenshot1, screenshot2) !== 0
}

test.describe('Agent Question Bank Tests', () => {
  test.describe('Without a backend', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/')
      await waitForAgentReady(page)
      await page.screenshot({ path: 'playwright-report/screenshots/initial-state.png' })
    })

    test('should load the application successfully', async ({ page }) => {
      await expect(page.locator('.app-container, div[class*="min-h-screen"]')).toBeVisible()
      await expect(page.locator('canvas')).toBeVisible()
      const hasChatInput = (await page.locator('input, textarea').count()) > 0
      expect(hasChatInput).toBe(true)
    })

    test('should have avatar visible and animating', async ({ page }) => {
      const canvas = page.locator('canvas').first()
      await expect(canvas).toBeVisible()
      const isAnimating = await checkAvatarAnimation(page)
      expect(isAnimating).toBe(true)
    })
  })

  test.describe('With Ollama', () => {
    let backendProblem: string | null = null

    test.beforeAll(async () => {
      backendProblem = await ollamaBackendProblem()
    })

    test.beforeEach(async ({ page }) => {
      if (backendProblem) {
        if (process.env.E2E_REQUIRE_BACKEND === '1') throw new Error(backendProblem)
        test.skip(true, backendProblem)
      }
      await page.goto('/')
      await waitForAgentReady(page)
      await passConnectionGate(page)
    })

    test.describe('Greeting Questions', () => {
      for (const question of getQuestionsFromCategory('greetings')) {
        test(`should respond to: "${question}"`, async ({ page }) => {
          const response = await ask(page, question)

          expect(response.length).toBeGreaterThan(0)
          noteIfUnlike(response, expectedPatterns.greetings, 'greeting')

          // The avatar keeps moving after it answers.
          const isAnimating = await checkAvatarAnimation(page)
          expect(isAnimating).toBe(true)
        })
      }
    })

    test.describe('Information Questions', () => {
      for (const question of getQuestionsFromCategory('information').slice(0, 3)) {
        test(`should respond to: "${question}"`, async ({ page }) => {
          const response = await ask(page, question)

          expect(response.length).toBeGreaterThan(0)
          noteIfUnlike(response, expectedPatterns.information, 'information')
        })
      }
    })

    test.describe('Technical Questions', () => {
      for (const question of getQuestionsFromCategory('technical').slice(0, 2)) {
        test(`should respond to: "${question}"`, async ({ page }) => {
          const response = await ask(page, question, 45000) // complex questions take longer
          expect(response.length).toBeGreaterThan(0)
        })
      }
    })

    test.describe('Conversational Questions', () => {
      for (const question of getQuestionsFromCategory('conversational').slice(0, 2)) {
        test(`should respond to: "${question}"`, async ({ page }) => {
          const response = await ask(page, question)
          expect(response.length).toBeGreaterThan(0)
        })
      }
    })

    test.describe('Math and Logic Questions', () => {
      for (const question of getQuestionsFromCategory('mathLogic').slice(0, 3)) {
        test(`should respond to: "${question}"`, async ({ page }) => {
          const response = await ask(page, question)

          expect(response.length).toBeGreaterThan(0)
          // Check for numbers in response
          if (expectedPatterns.mathLogic) {
            expect(response).toMatch(expectedPatterns.mathLogic)
          }
        })
      }
    })

    test('should handle rapid consecutive messages', async ({ page }) => {
      const before = await assistantReplyCount(page)
      for (const question of ['Hello', 'How are you?', 'What is your name?']) {
        await sendMessage(page, question)
        await page.waitForTimeout(500) // Small delay between messages
      }

      // At least one answer arrives, and the avatar is still responsive.
      const reply = await waitForReply(page, before, 45000)
      expect(reply.length).toBeGreaterThan(0)
      const isAnimating = await checkAvatarAnimation(page)
      expect(isAnimating).toBe(true)
    })

    test('should maintain conversation context', async ({ page }) => {
      await ask(page, 'My name is Test User')

      // Follow-up that requires context. What the app controls is that the earlier turn goes to the
      // model with the new question. Whether a small model then uses it is up to the model: on
      // 2026-11-25 gemma3:1b answered "my name is [AI Companion Name]" with the name in its context.
      const followUp = page.waitForRequest(
        (request) =>
          request.method() === 'POST' &&
          request.url().endsWith('/api/chat') &&
          (request.postData() ?? '').includes('What is my name?')
      )
      const response = await ask(page, 'What is my name?')

      const body = JSON.parse((await followUp).postData() ?? '{}') as {
        messages?: Array<{ role?: string; content?: string }>
      }
      const sentEarlierTurn = (body.messages ?? []).some(
        (message) => message.role === 'user' && (message.content ?? '').includes('My name is Test User')
      )
      expect(sentEarlierTurn, 'the follow-up request carries the earlier turn').toBe(true)
      expect(response.length).toBeGreaterThan(0)
      if (!response.toLowerCase().includes('test')) {
        test.info().annotations.push({ type: 'model', description: `the model did not use the name: "${response.slice(0, 120)}"` })
      }
    })
  })
})
