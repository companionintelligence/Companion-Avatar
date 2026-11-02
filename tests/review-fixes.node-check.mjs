import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('onboarding mic enable relies on config state instead of directly initializing VAD', async () => {
  const appSource = await readFile(`${repoRoot}/apps/web/src/App.tsx`, 'utf8')
  const sourceFile = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  let handleEnableMicDeclaration = null
  let setsMicrophoneFromGrant = false
  let referencesInitializeVAD = false

  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'handleEnableMic'
    ) {
      handleEnableMicDeclaration = node
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  assert.ok(handleEnableMicDeclaration, 'expected to find handleEnableMic callback')

  const inspectHandleEnableMic = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'AppConfigState' &&
      node.expression.name.text === 'set'
    ) {
      const setCallText = node.getText(sourceFile)
      setsMicrophoneFromGrant = /microphone:\s*granted/.test(setCallText)
    }

    if (ts.isIdentifier(node) && node.text === 'initializeVAD') {
      referencesInitializeVAD = true
    }

    ts.forEachChild(node, inspectHandleEnableMic)
  }

  inspectHandleEnableMic(handleEnableMicDeclaration)

  assert.equal(setsMicrophoneFromGrant, true, 'expected handleEnableMic to set microphone from the permission result via AppConfigState.set')
  assert.equal(referencesInitializeVAD, false, 'expected handleEnableMic to avoid direct initializeVAD calls')
})

test('toggle button uses the resolved size for right-side offsets and accessibility labels', async () => {
  const toggleButtonSource = await readFile(`${repoRoot}/packages/core/src/components/common/ToggleButton.tsx`, 'utf8')
  const sourceFile = ts.createSourceFile('ToggleButton.tsx', toggleButtonSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  let hasResolvedButtonSize = false
  let usesResolvedRightOffset = false
  let hasAccessibleLabel = false

  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'resolvedButtonSize' &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isPropertyAccessExpression(node.initializer.expression) &&
      ts.isIdentifier(node.initializer.expression.expression) &&
      node.initializer.expression.expression.text === 'Math' &&
      node.initializer.expression.name.text === 'max' &&
      node.initializer.arguments.length === 2 &&
      ts.isIdentifier(node.initializer.arguments[0]) &&
      node.initializer.arguments[0].text === 'MIN_BUTTON_SIZE' &&
      ts.isIdentifier(node.initializer.arguments[1]) &&
      node.initializer.arguments[1].text === 'size'
    ) {
      hasResolvedButtonSize = true
    }

    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'right' &&
      ts.isTemplateExpression(node.initializer) &&
      node.initializer.head.text === 'calc(' &&
      node.initializer.templateSpans.length === 2 &&
      ts.isIdentifier(node.initializer.templateSpans[0].expression) &&
      node.initializer.templateSpans[0].expression.text === 'basePosition' &&
      node.initializer.templateSpans[0].literal.text === ' - ' &&
      ts.isIdentifier(node.initializer.templateSpans[1].expression) &&
      node.initializer.templateSpans[1].expression.text === 'resolvedButtonSize' &&
      node.initializer.templateSpans[1].literal.text === 'px)'
    ) {
      usesResolvedRightOffset = true
    }

    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'aria-label' &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression &&
      ts.isTemplateExpression(node.initializer.expression) &&
      node.initializer.expression.head.text === '' &&
      node.initializer.expression.templateSpans.length === 2 &&
      ts.isConditionalExpression(node.initializer.expression.templateSpans[0].expression) &&
      ts.isIdentifier(node.initializer.expression.templateSpans[0].expression.condition) &&
      node.initializer.expression.templateSpans[0].expression.condition.text === 'isVisible' &&
      ts.isStringLiteral(node.initializer.expression.templateSpans[0].expression.whenTrue) &&
      node.initializer.expression.templateSpans[0].expression.whenTrue.text === 'Hide' &&
      ts.isStringLiteral(node.initializer.expression.templateSpans[0].expression.whenFalse) &&
      node.initializer.expression.templateSpans[0].expression.whenFalse.text === 'Show' &&
      node.initializer.expression.templateSpans[0].literal.text === ' ' &&
      ts.isIdentifier(node.initializer.expression.templateSpans[1].expression) &&
      node.initializer.expression.templateSpans[1].expression.text === 'label' &&
      node.initializer.expression.templateSpans[1].literal.text === ''
    ) {
      hasAccessibleLabel = true
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  assert.equal(hasResolvedButtonSize, true, 'expected ToggleButton to derive a resolved button size once')
  assert.equal(usesResolvedRightOffset, true, 'expected ToggleButton right offset to use the resolved button size')
  assert.equal(hasAccessibleLabel, true, 'expected ToggleButton to expose a stable aria-label')
})
