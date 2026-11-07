export declare function workspaceTree(): string;
export declare function fakeApi(root: string, settings?: Record<string, any>, opts?: {
    twgPath?: string;
    screens?: any[];
}): {
    api: any;
    calls: Record<string, any>;
};
