import worker from '../worker/relay'

function relayRequest(target: string): Request {
  return new Request(`https://relay.example/relay?url=${encodeURIComponent(target)}`)
}

test('a relayed active document is delivered with a browser-enforced sandbox policy', async () => {
  const response = await worker.fetch(relayRequest('https://openstax.org/rex/release.json'), {
    fetch: async () => new Response(
      '<script>parent.postMessage("relay-script-ran", "*")</script>',
      { headers: { 'content-type': 'text/html' } },
    ),
  })

  const policy = response.headers.get('content-security-policy')
  expect(policy).toContain('sandbox')
  expect(response.headers.get('content-disposition')).toContain('attachment')

  // Exercise the browser behavior represented by the response policy: a
  // sandbox without allow-scripts cannot execute the same active markup or
  // reach the parent document's IndexedDB origin.
  const messages: string[] = []
  const onMessage = (event: MessageEvent) => {
    if (typeof event.data === 'string') messages.push(event.data)
  }
  window.addEventListener('message', onMessage)
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', '')
  frame.srcdoc = '<script>parent.postMessage("relay-script-ran", "*")</script>'
  document.body.appendChild(frame)
  await new Promise((resolve) => setTimeout(resolve, 50))
  frame.remove()
  window.removeEventListener('message', onMessage)

  expect(messages).not.toContain('relay-script-ran')
})
