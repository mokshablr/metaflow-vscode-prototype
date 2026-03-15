from metaflow import FlowSpec, step

class ExampleFlow(FlowSpec):

    @step
    def start(self):
        self.x = 42
        self.next(self.step_a)

    @step
    def step_a(self):
        self.y = self.x * 2
        self.next(self.end)

    @step
    def end(self):
        print("done")

if __name__ == "__main__":
    ExampleFlow()
