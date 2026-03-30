from metaflow import FlowSpec, step, Parameter

class ParametrizedFlow(FlowSpec):
    alpha = Parameter('alpha', default=0.01, type=float, help='Learning rate')
    epochs = Parameter('epochs', default=10, type=int, help='Number of training epochs')
    tag = Parameter('tag', default='experiment', type=str, help='Run tag label')

    @step
    def start(self):
        print(f"alpha={self.alpha}, epochs={self.epochs}, tag={self.tag}")
        self.next(self.end)

    @step
    def end(self):
        print("done")

if __name__ == "__main__":
    ParametrizedFlow()
