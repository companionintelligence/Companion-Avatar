import { test, expect, type Page } from '@playwright/test'
import { timingSkipReason } from './support/timingGate'

/**
 * Helper to wait for agent ready
 */
async function waitForAgentReady(page: Page) {
  await page.waitForSelector('.app-container, div[class*="min-h-screen"]', { timeout: 30000 })
  await page.waitForSelector('canvas', { timeout: 30000 })
  await page.waitForTimeout(2000)
}

/**
 * The page's `window`/`performance` as these specs see it: globals a debug build may
 * attach, plus Chrome's non-standard `performance.memory`.
 */
type TestWindow = Window &
  typeof globalThis & {
    THREE?: unknown
    VRM?: unknown
    vrm?: unknown
  }
type PerformanceWithMemory = Performance & { memory?: { usedJSHeapSize: number } }

/**
 * Helper to check if avatar is animating by comparing frames
 */
async function isAvatarAnimating(page: Page, samples = 5, interval = 200): Promise<boolean> {
  const screenshots: Buffer[] = []
  const canvas = page.locator('canvas').first()
  
  for (let i = 0; i < samples; i++) {
    screenshots.push(await canvas.screenshot())
    await page.waitForTimeout(interval)
  }
  
  // Compare consecutive screenshots
  let differences = 0
  for (let i = 1; i < screenshots.length; i++) {
    if (Buffer.compare(screenshots[i - 1], screenshots[i]) !== 0) {
      differences++
    }
  }
  
  // If more than 50% of frames are different, it's animating
  return differences >= (samples - 1) * 0.5
}

/**
 * Helper to check animation smoothness (FPS estimation)
 */
async function estimateFPS(page: Page, duration = 2000): Promise<number> {
  return await page.evaluate((duration) => {
    return new Promise<number>((resolve) => {
      let frames = 0
      const startTime = performance.now()
      
      function countFrame() {
        frames++
        const elapsed = performance.now() - startTime
        
        if (elapsed < duration) {
          requestAnimationFrame(countFrame)
        } else {
          const fps = frames / (elapsed / 1000)
          resolve(fps)
        }
      }
      
      requestAnimationFrame(countFrame)
    })
  }, duration)
}

/**
 * Check for Three.js presence and rendering
 */
async function checkThreeJSRendering(page: Page) {
  return await page.evaluate(() => {
    const hasThree = typeof (window as TestWindow).THREE !== 'undefined'
    
    // Check for canvas WebGL context
    const canvas = document.querySelector('canvas') as HTMLCanvasElement
    const hasWebGL = canvas?.getContext('webgl') !== null || 
                     canvas?.getContext('webgl2') !== null ||
                     canvas?.getContext('experimental-webgl') !== null
    
    return {
      hasThree,
      hasWebGL,
      canvasCount: document.querySelectorAll('canvas').length
    }
  })
}

test.describe('Avatar Animation Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForAgentReady(page)
  })

  test('should have 3D canvas rendering', async ({ page }) => {
    const canvas = page.locator('canvas').first()
    await expect(canvas).toBeVisible()
    
    // Check canvas has reasonable dimensions
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThan(100)
    expect(box!.height).toBeGreaterThan(100)
  })

  test('should have Three.js and WebGL context', async ({ page }) => {
    const renderingInfo = await checkThreeJSRendering(page)
    
    console.log('Rendering Info:', renderingInfo)
    
    expect(renderingInfo.hasWebGL).toBe(true)
    expect(renderingInfo.canvasCount).toBeGreaterThan(0)
  })

  test('should have avatar actively animating (idle state)', async ({ page }) => {
    // Wait a bit for initial load
    await page.waitForTimeout(2000)
    
    // Check if avatar is animating
    const isAnimating = await isAvatarAnimating(page)
    
    expect(isAnimating).toBe(true)
    
    // Take a screenshot showing animation
    await page.screenshot({ path: 'playwright-report/screenshots/avatar-idle-animation.png' })
  })

  test('should maintain acceptable frame rate', async ({ page }) => {
    // Only where a frame rate means something: a GPU, and a host that is not swamped.
    const unmeasurable = await timingSkipReason(page)
    test.skip(unmeasurable !== null, unmeasurable ?? '')

    // Estimate FPS
    const fps = await estimateFPS(page, 3000)
    
    console.log(`Estimated FPS: ${fps.toFixed(2)}`)
    
    // Should be at least 30 FPS for smooth animation
    expect(fps).toBeGreaterThan(30)
    
    // Ideally close to 60 FPS
    if (fps > 55) {
      console.log('✅ Excellent frame rate (near 60 FPS)')
    } else if (fps > 30) {
      console.log('✅ Acceptable frame rate (above 30 FPS)')
    } else {
      console.log('⚠️ Low frame rate (below 30 FPS)')
    }
  })

  test('should show different animations during conversation', async ({ page }) => {
    // Capture idle animation
    const idleScreenshot = await page.locator('canvas').first().screenshot()
    
    // Send a message to trigger talking animation
    const chatInput = page.locator('input[type="text"], textarea').first()
    await chatInput.fill('Tell me a long story about technology')
    await chatInput.press('Enter')
    
    // Wait for agent to start responding
    await page.waitForTimeout(3000)
    
    // Capture talking animation
    const talkingScreenshot = await page.locator('canvas').first().screenshot()
    
    // The animations should be different
    expect(Buffer.compare(idleScreenshot, talkingScreenshot)).not.toBe(0)
    
    // Save both for visual comparison
    await page.screenshot({ path: 'playwright-report/screenshots/avatar-talking.png' })
  })

  test('should have lip sync during speech', async ({ page }) => {
    // Send a message
    const chatInput = page.locator('input[type="text"], textarea').first()
    await chatInput.fill('Please speak slowly and clearly')
    await chatInput.press('Enter')
    
    // Wait for response to start
    await page.waitForTimeout(2000)
    
    // During speech, animation should be very active
    const isAnimating = await isAvatarAnimating(page, 10, 100) // More samples, shorter interval
    
    expect(isAnimating).toBe(true)
    
    // Take screenshot during speech
    await page.screenshot({ path: 'playwright-report/screenshots/avatar-lip-sync.png' })
  })

  test('should have blinking animation', async ({ page }) => {
    // Twenty canvas screenshots in ten seconds: with software rendering or a swamped host they
    // outlast the test's timeout before a blink can be seen.
    const unmeasurable = await timingSkipReason(page)
    test.skip(unmeasurable !== null, unmeasurable ?? '')

    // Blinks should occur every 2-8 seconds according to emote config
    // We'll watch for 10 seconds and check for changes
    
    const duration = 10000
    const startTime = Date.now()
    let frameChanges = 0
    let lastFrame: Buffer | null = null
    
    while (Date.now() - startTime < duration) {
      const currentFrame = await page.locator('canvas').first().screenshot()
      
      if (lastFrame && Buffer.compare(lastFrame, currentFrame) !== 0) {
        frameChanges++
      }
      
      lastFrame = currentFrame
      await page.waitForTimeout(500)
    }
    
    console.log(`Frame changes in ${duration}ms: ${frameChanges}`)
    
    // Should have multiple frame changes due to blinking and idle animation
    expect(frameChanges).toBeGreaterThan(5)
  })

  test('should respond to emotes/emotions', async ({ page }) => {
    // Three messages, each followed by canvas screenshots: with software rendering on a busy host
    // that outlasted the 60 s default (2026-11-25), so this test gets three times as long.
    test.slow()
    // This would require triggering different emotions
    // For now, we'll just verify the system can handle emotion changes
    
    // Send different types of messages to trigger different emotions
    const messages = [
      'That makes me happy!',
      'I am confused',
      'Wow, that is surprising!',
    ]
    
    for (const message of messages) {
      const chatInput = page.locator('input[type="text"], textarea').first()
      await chatInput.fill(message)
      await chatInput.press('Enter')
      
      await page.waitForTimeout(2000)
      
      // Check avatar is still animating after emotion
      const isAnimating = await isAvatarAnimating(page)
      expect(isAnimating).toBe(true)
      
      // Wait before next message
      await page.waitForTimeout(1000)
    }
  })

  test('should have gaze following behavior', async ({ page }) => {
    // Avatar should look at the camera/user
    // This is hard to test directly, but we can verify the gaze system is active
    
    // Take several screenshots to see if head position varies
    const screenshots = []
    for (let i = 0; i < 5; i++) {
      screenshots.push(await page.locator('canvas').first().screenshot())
      await page.waitForTimeout(1000)
    }
    
    // At least some frames should be different due to gaze adjustments
    let differentFrames = 0
    for (let i = 1; i < screenshots.length; i++) {
      if (Buffer.compare(screenshots[i - 1], screenshots[i]) !== 0) {
        differentFrames++
      }
    }
    
    expect(differentFrames).toBeGreaterThan(0)
  })

  test('should handle animation state transitions smoothly', async ({ page }) => {
    // Monitor FPS during state transition
    const fpsBefore = await estimateFPS(page, 1000)
    
    // Trigger a state change
    const chatInput = page.locator('input[type="text"], textarea').first()
    await chatInput.fill('Hello')
    await chatInput.press('Enter')
    
    await page.waitForTimeout(500)
    
    const fpsDuring = await estimateFPS(page, 1000)
    
    console.log(`FPS before transition: ${fpsBefore.toFixed(2)}`)
    console.log(`FPS during transition: ${fpsDuring.toFixed(2)}`)
    
    // FPS should not drop dramatically during transitions
    expect(fpsDuring).toBeGreaterThan(fpsBefore * 0.7) // Allow 30% drop max
  })

  test('should load and display VRM avatar model', async ({ page }) => {
    // Check if VRM model is loaded
    const vrmInfo = await page.evaluate(() => {
      // Check for VRM-related objects in window
      const hasVRM = typeof (window as TestWindow).VRM !== 'undefined' ||
                     typeof (window as TestWindow).vrm !== 'undefined'
      
      return {
        hasVRM,
        // Could check for specific VRM properties if accessible
      }
    })
    
    console.log('VRM Info:', vrmInfo)
    
    // Avatar should be visible on canvas
    const canvas = page.locator('canvas').first()
    await expect(canvas).toBeVisible()
  })

  test('should have facial expressions in animation', async ({ page }) => {
    // Facial expressions should cause visible changes
    // We'll monitor animation activity during a conversation
    
    const chatInput = page.locator('input[type="text"], textarea').first()
    await chatInput.fill('You are amazing!')
    await chatInput.press('Enter')
    
    // During response, check for active animation
    await page.waitForTimeout(2000)
    
    const isActivelyAnimating = await isAvatarAnimating(page, 10, 150)
    expect(isActivelyAnimating).toBe(true)
  })
})

test.describe('Avatar Performance Tests', () => {
  test('should not have memory leaks during extended use', async ({ page }) => {
    await page.goto('/')
    await waitForAgentReady(page)
    
    // Get initial memory
    const initialMetrics = await page.evaluate(() => ({
      memory: (performance as PerformanceWithMemory).memory?.usedJSHeapSize,
      timestamp: Date.now()
    }))
    
    // Run for a while with interactions
    for (let i = 0; i < 5; i++) {
      const chatInput = page.locator('input[type="text"], textarea').first()
      await chatInput.fill(`Message ${i + 1}`)
      await chatInput.press('Enter')
      await page.waitForTimeout(3000)
    }
    
    // Get final memory
    const finalMetrics = await page.evaluate(() => ({
      memory: (performance as PerformanceWithMemory).memory?.usedJSHeapSize,
      timestamp: Date.now()
    }))
    
    console.log('Initial memory:', initialMetrics.memory)
    console.log('Final memory:', finalMetrics.memory)
    
    if (initialMetrics.memory && finalMetrics.memory) {
      const growth = finalMetrics.memory - initialMetrics.memory
      const growthPercent = (growth / initialMetrics.memory) * 100
      
      console.log(`Memory growth: ${growthPercent.toFixed(2)}%`)
      
      // Memory should not grow excessively
      expect(growthPercent).toBeLessThan(200) // Less than 2x growth
    }
  })

  test('should handle window resize gracefully', async ({ page }) => {
    await page.goto('/')
    await waitForAgentReady(page)
    
    // Check animation before resize
    const animatingBefore = await isAvatarAnimating(page)
    expect(animatingBefore).toBe(true)
    
    // Resize window
    await page.setViewportSize({ width: 800, height: 600 })
    await page.waitForTimeout(500)
    
    // Check animation after resize
    const animatingAfter = await isAvatarAnimating(page)
    expect(animatingAfter).toBe(true)
    
    // Resize back
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.waitForTimeout(500)
    
    const animatingFinal = await isAvatarAnimating(page)
    expect(animatingFinal).toBe(true)
  })
})
