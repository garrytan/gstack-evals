class HostedRenderer:
    def __init__(self, transport):
        self.transport = transport

    def render(self, rows, template):
        response = self.transport.post(
            'https://render.label-service.invalid/jobs',
            json={'template': template, 'products': rows},
        )
        response.raise_for_status()
        return response.content
