import * as React from 'react';
import Collection from '../collection';
import FactoryComponent, {
  RenderPropsWithCollection
} from '../factory/component';

export interface FindProps<T, TResult> extends RenderPropsWithCollection<T> {
  transform?: (item: T) => TResult;
  collection: string;
  sort?: string;
  [key: string]: any;
}

class Find<T, TResult> extends React.Component<FindProps<T, TResult>> {
  static ofType<T, TResult = T>() {
    return Find as new (props: FindProps<T, TResult>) => Find<T, TResult>;
  }
  transform = (value: any) => {
    const { transform } = this.props;
    if (transform) {
      return transform(value);
    }
    return value;
  };
  render() {
    const { transform, collection, ...props } = this.props;
    return (
      <Collection
        name={collection}
        render={col => (
          <FactoryComponent
            {...props}
            transform={this.transform}
            method="findOne"
            collection={col}
          />
        )}
      />
    );
  }
}

export default Find;
